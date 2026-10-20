import { getEventConfigRegistry } from "../config/EventConfig.js";
import { CUSTOM_SEASON_ID } from "../js/constants.js";
import type {
    SeasonId,
    SiteId,
    SeasonMetadata,
    SiteGeocode,
    SiteRecord,
    SiteRecordMap,
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
    private readonly cache: Record<SeasonId, SiteRecordMap> = {
        [CUSTOM_SEASON_ID]: {},
    };
    private readonly inflight = new Map<SeasonId, Promise<SiteRecordMap>>();

    /**
     * Retrieves the telemetry map for a given season, loading it if not cached.
     * Throws an Error if the request fails, avoiding silent failure/null swallowing.
     * Deduplicates concurrent requests for the same season.
     */
    public async getSeasonData(seasonId: SeasonId): Promise<SiteRecordMap> {
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
            const data = (await response.json()) as SiteRecordMap;
            this.cache[seasonId] = data;
            return data;
        })().finally(() => {
            this.inflight.delete(seasonId);
        });

        this.inflight.set(seasonId, fetchPromise);
        return fetchPromise;
    }

    /**
     * Retrieves a site's telemetry record, returning from cache if available or loading the season data.
     */
    public async getSiteData(seasonId: SeasonId, siteId: SiteId): Promise<SiteRecord | undefined> {
        if (seasonId in this.cache) {
            return this.cache[seasonId]?.[siteId];
        }
        const seasonData = await this.getSeasonData(seasonId);
        return seasonData[siteId];
    }

    public addCustomData(processedData: { data: SiteRecordMap }): void {
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
export async function getSeasonData(seasonId: SeasonId): Promise<SiteRecordMap> {
    return seasonDataStore.getSeasonData(seasonId);
}

/** @deprecated Call seasonDataStore.getSiteData() directly */
export async function getSiteData(seasonId: SeasonId, siteId: SiteId): Promise<SiteRecord | undefined> {
    return seasonDataStore.getSiteData(seasonId, siteId);
}

/** @deprecated Call seasonDataStore.addCustomData() directly */
export function addCustomData(processedData: { geocode: { sites: LegacySiteGeocode[] }; data: SiteRecordMap }): void {
    seasonDataStore.addCustomData(processedData);
}

/** @deprecated Query EventConfigRegistry directly via getEventConfigRegistry().getDefaultSeasonId() */
export function getDefaultSeasonId(): SeasonId | null {
    return getEventConfigRegistry().getDefaultSeasonId() ?? null;
}

/** @deprecated Query EventConfigRegistry directly via getEventConfigRegistry().getAllSeasonIds() */
export function getAllSeasonIds(): SeasonId[] {
    return [CUSTOM_SEASON_ID, ...getEventConfigRegistry().getAllSeasonIds()];
}

/** @deprecated Query EventConfigRegistry directly */
export function getSeasonMetadata(seasonId: SeasonId): SeasonMetadata | undefined {
    if (seasonId === CUSTOM_SEASON_ID) {
        return { id: CUSTOM_SEASON_ID, name: "Custom", year: new Date().getFullYear(), overviewUrl: "", components: [] };
    }
    return getEventConfigRegistry().getSeasonMetadata(seasonId);
}

/** @deprecated Query EventConfigRegistry directly */
export function getSeasonGeocode(seasonId: SeasonId): { sites: Record<SiteId, LegacySiteGeocode> } | undefined {
    const seasonSites = getEventConfigRegistry().getSitesForSeason(seasonId);
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
