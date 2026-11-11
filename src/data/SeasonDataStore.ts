import { getConfigRegistry } from "../config/EventConfig.js";
import { CUSTOM_SEASON_ID } from "../js/constants.js";
import type {
    SeasonId,
    SiteId,
    SeasonMetadata,
    SiteGeocode,
    SiteState,
    SiteStateMap,
} from "@ingress-shards/ingress-events-core";

/**
 * @deprecated Transitional geocode interface providing legacy decimal coordinates (.lat, .lng)
 * and legacy snake_case properties for Leaflet UI renderers.
 */
export type LegacySiteGeocode = SiteGeocode & {
    lat: number;
    lng: number;
    timezone: string;
    date: string;
    country_code?: string;
};

/**
 * Service responsible solely for lazy-loading and in-memory caching of season telemetry.
 */
export class SeasonDataStore {
    private readonly cache: Record<SeasonId, SiteStateMap> = {
        [CUSTOM_SEASON_ID]: {},
    };
    private readonly inflight = new Map<SeasonId, Promise<SiteStateMap>>();

    /**
     * Retrieves the telemetry map for a given season, loading it if not cached.
     * Throws an Error if the request fails, avoiding silent failure/null swallowing.
     * Deduplicates concurrent requests for the same season.
     */
    public async getSeasonData(seasonId: SeasonId): Promise<SiteStateMap> {
        if (!seasonId) {
            throw new Error("Cannot fetch season data: seasonId is required.");
        }

        if (seasonId in this.cache) {
            return this.cache[seasonId]!;
        }

        const activeRequest = this.inflight.get(seasonId);
        if (activeRequest) {
            return activeRequest;
        }

        const fetchPromise = (async () => {
            const response = await fetch(`data/${seasonId}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load season data for ${seasonId}: HTTP ${response.status} ${response.statusText}`);
            }
            const data = (await response.json()) as SiteStateMap;
            this.cache[seasonId] = data;
            return data;
        })().finally(() => {
            this.inflight.delete(seasonId);
        });

        this.inflight.set(seasonId, fetchPromise);
        return fetchPromise;
    }

    /**
     * Retrieves a site's telemetry state, returning from cache if available or loading the season data.
     * Adapts SiteState into transitional legacy shapes for Leaflet renderers until Phase 5.
     */
    public async getSiteData(seasonId: SeasonId, siteId: SiteId): Promise<unknown | undefined> {
        const seasonData = await this.getSeasonData(seasonId);
        const state = seasonData[siteId];
        if (!state) return undefined;
        return adaptSiteStateToLegacy(state);
    }

    public addCustomData(processedData: { data: SiteStateMap }): void {
        const custom = this.cache[CUSTOM_SEASON_ID];
        if (custom) {
            Object.assign(custom, processedData.data);
        }
    }
}

/**
 * @deprecated Transitional singleton instance for remaining legacy .js files.
 */
export const seasonDataStore = new SeasonDataStore();

/** @deprecated Call seasonDataStore.getSeasonData() directly */
export async function getSeasonData(seasonId: SeasonId): Promise<SiteStateMap> {
    return seasonDataStore.getSeasonData(seasonId);
}

/** @deprecated Call seasonDataStore.getSiteData() directly */
export async function getSiteData(seasonId: SeasonId, siteId: SiteId): Promise<unknown | undefined> {
    return seasonDataStore.getSiteData(seasonId, siteId);
}

/** @deprecated Call seasonDataStore.addCustomData() directly */
export function addCustomData(processedData: { geocode: { sites: LegacySiteGeocode[] }; data: SiteStateMap }): void {
    seasonDataStore.addCustomData(processedData);
}

/** @deprecated Query ConfigRegistry directly via getConfigRegistry().getDefaultSeasonId() */
export function getDefaultSeasonId(): SeasonId | null {
    return getConfigRegistry().getDefaultSeasonId() ?? null;
}

/** @deprecated Query ConfigRegistry directly via getConfigRegistry().getAllSeasonIds() */
export function getAllSeasonIds(): SeasonId[] {
    return [CUSTOM_SEASON_ID, ...getConfigRegistry().getAllSeasonIds()];
}

/** @deprecated Query ConfigRegistry directly */
export function getSeasonMetadata(seasonId: SeasonId): SeasonMetadata | undefined {
    if (seasonId === CUSTOM_SEASON_ID) {
        return { id: CUSTOM_SEASON_ID, name: "Custom", overviewUrl: "", events: [] } as unknown as SeasonMetadata;
    }
    return getConfigRegistry().getSeasonMetadata(seasonId);
}

/** @deprecated Query ConfigRegistry directly */
export function getSeasonGeocode(seasonId: SeasonId): { sites: Record<SiteId, LegacySiteGeocode> } | undefined {
    const seasonSites = getConfigRegistry().getSitesForSeason(seasonId);
    if (seasonSites.length === 0) return undefined;
    const sites: Record<SiteId, LegacySiteGeocode> = {};
    for (const site of seasonSites) {
        sites[site.geocode.id] = {
            ...site.geocode,
            lat: site.geocode.latE6 / 1e6,
            lng: site.geocode.lngE6 / 1e6,
            timezone: site.geocode.timeZone,
            date: site.geocode.startTime,
            country_code: site.geocode.countryCode,
        };
    }
    return { sites };
}

function adaptSiteStateToLegacy(state: SiteState): unknown {
    if (!state || "geocode" in state) return state;

    const registry = getConfigRegistry();
    const siteConfig = registry.getSiteConfig(state.metadata.siteId);
    const gc = siteConfig?.geocode;
    const timezone = gc?.timeZone ?? "UTC";

    const geocode = gc ? {
        ...gc,
        lat: gc.latE6 / 1e6,
        lng: gc.lngE6 / 1e6,
        timezone,
        date: gc.startTime,
        country_code: gc.countryCode,
    } : undefined;

    const portals: Record<number, Record<string, unknown>> = {};
    for (const [idStr, p] of Object.entries(state.telemetry?.portals ?? {})) {
        const id = Number(idStr);
        const pRecord = p as unknown as {
            ornamentId?: string;
            guid?: string;
            history?: Array<{ type?: string; ornId?: string }>;
        };
        const ornamentId = pRecord.history?.find(h => h.type === "pre-event")?.ornId
            ?? pRecord.history?.find(h => h.type === "target")?.ornId
            ?? pRecord.ornamentId;
        portals[id] = {
            id,
            title: p.title,
            lat: p.latE6 / 1e6,
            lng: p.lngE6 / 1e6,
            latE6: p.latE6,
            lngE6: p.lngE6,
            ...(ornamentId && { ornamentId }),
            ...(pRecord.guid && { guid: pRecord.guid }),
        };
    }

    const rawShards = Object.entries(state.telemetry?.shards ?? {}).map(([id, sh]) => ({
        id: Number(id),
        history: sh.history?.map(h => ({
            ...h,
            team: h.align,
            reason: h.action,
            moveTimeMs: String(h.moveTime),
        })) ?? [],
    }));

    const allShards = rawShards.flatMap(shard => {
        const history = shard.history ?? [];
        const spawnCount = history.filter(h => (h.action === "spawn" || h.reason === "spawn")).length;
        if (spawnCount <= 1) return [{ id: shard.id, history }];

        const instances: Array<{ id: number; history: Record<string, unknown>[] }> = [];
        let current: { id: number; history: Record<string, unknown>[] } | null = null;
        for (const h of history) {
            const action = h.action || h.reason;
            if (action === "spawn" || !current) {
                current = { id: shard.id, history: [] };
                instances.push(current);
            }
            current.history.push(h);
        }
        return instances;
    });

    const centroid = state.analysis?.centroid ? {
        lat: state.analysis.centroid.latE6 / 1e6,
        lng: state.analysis.centroid.lngE6 / 1e6,
    } : undefined;

    const shardPaths: Record<string, unknown> = {};
    if (state.analysis?.shardPaths) {
        for (const [pathKey, sp] of Object.entries(state.analysis.shardPaths)) {
            const [p1, p2] = pathKey.split("-").map(Number);
            shardPaths[pathKey] = {
                originPortalId: p1,
                destinationPortalId: p2,
                originPortal: portals[p1!],
                destinationPortal: portals[p2!],
                distance: sp.distance,
                links: sp.links.map(l => ({
                    linkTime: l.linkTime,
                    time: l.linkTime,
                    team: l.align,
                    moves: l.moves,
                })),
                ...(sp.teleports && { jumps: sp.teleports }),
            };
        }
    }

    const timelineWaves = siteConfig?.timeline?.shards;
    const waves = (timelineWaves && timelineWaves.length > 1)
        ? timelineWaves.map((tw, idx) => {
            const nextStart = timelineWaves[idx + 1]?.start ?? (tw.end + 60000);
            const waveShards = allShards.filter(sh => {
                const spawn = sh.history?.find(h => (h.action === "spawn" || h.reason === "spawn")) ?? sh.history?.[0];
                const t = spawn ? Number(spawn.moveTime) : null;
                return t !== null && t >= tw.start && t < nextStart;
            });

            const waveShardPaths: Record<string, unknown> = {};
            if (state.analysis?.shardPaths) {
                for (const [pathKey, sp] of Object.entries(state.analysis.shardPaths)) {
                    const linksInWave = sp.links
                        .map(l => {
                            const movesInWave = l.moves.filter(m => m.moveTime >= tw.start && m.moveTime < nextStart);
                            if (movesInWave.length === 0) return null;
                            return {
                                linkTime: l.linkTime,
                                time: l.linkTime,
                                team: l.align,
                                moves: movesInWave,
                            };
                        })
                        .filter((l): l is NonNullable<typeof l> => l !== null);

                    const teleportsInWave = sp.teleports?.filter(t => t.moveTime >= tw.start && t.moveTime < nextStart);

                    if (linksInWave.length > 0 || (teleportsInWave && teleportsInWave.length > 0)) {
                        const [p1, p2] = pathKey.split("-").map(Number);
                        waveShardPaths[pathKey] = {
                            originPortalId: p1,
                            destinationPortalId: p2,
                            originPortal: portals[p1!],
                            destinationPortal: portals[p2!],
                            distance: sp.distance,
                            links: linksInWave,
                            ...(teleportsInWave && teleportsInWave.length > 0 && { jumps: teleportsInWave }),
                        };
                    }
                }
            }

            const waveScores = { RES: 0, ENL: 0, MAC: 0 };
            for (const sh of waveShards) {
                for (const h of sh.history ?? []) {
                    const action = (h as { action?: string; reason?: string }).action ?? (h as { action?: string; reason?: string }).reason;
                    if (action === "link") {
                        const team = (h as { team?: string; align?: string }).team ?? (h as { team?: string; align?: string }).align;
                        if (team && team in waveScores) {
                            waveScores[team as keyof typeof waveScores]++;
                        }
                    }
                }
            }

            const waveTargets: { RES: number[]; ENL: number[] } = { RES: [], ENL: [] };
            for (const [idStr, p] of Object.entries(state.telemetry?.portals ?? {})) {
                const pid = Number(idStr);
                const pHistory = (p as unknown as { history?: Array<{ type?: string; ornId?: string; timestamp?: number }> }).history;
                if (!pHistory) continue;
                for (const h of pHistory) {
                    if (h.type === "target" && h.timestamp !== undefined && h.timestamp >= tw.start && h.timestamp <= tw.end) {
                        if (h.ornId === "targetres") waveTargets.RES.push(pid);
                        else if (h.ornId === "targetenl") waveTargets.ENL.push(pid);
                    }
                }
            }

            const waveAnalysis = state.analysis?.waves?.[idx + 1];

            const emptyWaveCounters = {
                shards: {
                    moving: 0,
                    nonMoving: waveShards.length,
                },
                links: 0,
                paths: 0,
            };

            return {
                waveIndex: idx,
                period: { start: tw.start, end: tw.end },
                shards: waveShards,
                shardPaths: waveShardPaths,
                targets: waveTargets,
                scores: waveScores,
                counters: waveAnalysis?.statistics ?? emptyWaveCounters,
            };
        })
        : undefined;

    const totalScores = { RES: 0, ENL: 0, MAC: 0 };
    if (waves && waves.length > 0) {
        for (const w of waves) {
            totalScores.RES += (w.scores?.RES ?? 0);
            totalScores.ENL += (w.scores?.ENL ?? 0);
            totalScores.MAC += (w.scores?.MAC ?? 0);
        }
    } else {
        for (const sh of allShards) {
            for (const h of sh.history ?? []) {
                const action = (h as { action?: string; reason?: string }).action ?? (h as { action?: string; reason?: string }).reason;
                if (action === "link") {
                    const team = (h as { team?: string; align?: string }).team ?? (h as { team?: string; align?: string }).align;
                    if (team && team in totalScores) {
                        totalScores[team as keyof typeof totalScores]++;
                    }
                }
            }
        }
    }

    const counters = state.analysis?.statistics
        ?? { shards: { moving: allShards.length, nonMoving: 0 }, links: 0, paths: 0 };

    const fullEvent = {
        shards: allShards,
        shardPaths,
        scores: totalScores,
        counters,
    };

    return {
        ...state,
        geocode,
        portals,
        centroid,
        waves,
        fullEvent,
    };
}
