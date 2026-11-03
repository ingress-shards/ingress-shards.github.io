import type { EventConfigRegistry, SiteRecord, ObservedPortal } from "@ingress-shards/ingress-events-core";
import { formatTimeWithMs } from "./CsvHelpers.js";

export interface AdaptedShardHistoryItem {
    action?: string;
    reason?: string;
    moveTime?: number | string;
    portalId?: string;
    dest?: string;
    team?: string;
    originTeam?: string;
    destTeam?: string;
    mismatch?: boolean | Record<string, unknown>;
    linkTime?: number | string;
    [key: string]: unknown;
}

export interface AdaptedShard {
    id: number;
    history: AdaptedShardHistoryItem[];
}

export interface AlignmentMismatchItem {
    shardId: number;
    time: string;
    moveTime: number;
    linkTeam: string | undefined;
    originPortal: string;
    originTeam: string | undefined;
    destPortal: string;
    destTeam: string | undefined;
}

export interface AdaptedSiteForValidation {
    geocode?: {
        id: string;
        name: string;
        eventType: string;
        date: string;
        timezone: string;
    };
    portals: Record<number, ObservedPortal>;
    waves?: {
        waveIndex: number;
        shards: AdaptedShard[];
    }[];
    fullEvent: {
        shards: AdaptedShard[];
        alignmentMismatches: AlignmentMismatchItem[];
    };
}

export function adaptRecordForValidation(record: SiteRecord, registry: EventConfigRegistry): AdaptedSiteForValidation {
    const siteId = record.metadata.siteId;
    const siteConfig = registry.getSiteConfig(siteId);
    const gc = siteConfig?.geocode;
    const timezone = gc?.timeZone ?? "UTC";

    const geocode = gc ? {
        id: gc.id,
        name: gc.name,
        eventType: gc.eventType,
        date: gc.startTime,
        timezone,
    } : undefined;

    const portals = record.observations?.portals ?? {};
    const rawShards = Object.entries(record.observations?.shards ?? {}).map(([id, sh]) => ({
        id: Number(id),
        history: (sh.history ?? []) as unknown as AdaptedShardHistoryItem[],
    }));

    // Split reused shards (Niantic shard re-use across waves with multiple spawns)
    const allShards: AdaptedShard[] = rawShards.flatMap(shard => {
        const history = shard.history;
        const spawnCount = history.filter(h => (h.action === "spawn" || h.reason === "spawn")).length;
        if (spawnCount <= 1) return [{ id: shard.id, history }];

        const instances: AdaptedShard[] = [];
        let current: AdaptedShard | null = null;
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

    const timelineWaves = siteConfig?.timeline?.shards;
    const waves = (timelineWaves && timelineWaves.length > 1)
        ? timelineWaves.map((tw, idx) => {
            const nextStart = timelineWaves[idx + 1]?.start ?? (tw.end + 60000);
            const waveShards = allShards.filter(sh => {
                const spawn = sh.history.find(h => (h.action === "spawn" || h.reason === "spawn")) ?? sh.history[0];
                const t = spawn ? Number(spawn.moveTime) : null;
                return t !== null && t >= tw.start && t < nextStart;
            });
            return { waveIndex: idx, shards: waveShards };
        })
        : undefined;

    const alignmentMismatches: AlignmentMismatchItem[] = [];
    for (const [shardId, shard] of Object.entries(record.observations?.shards ?? {})) {
        for (const h of shard.history ?? []) {
            const action = h.action || (h as unknown as { reason?: string }).reason;
            if (h.mismatch && action === "link") {
                const originPortal = h.portalId !== undefined ? portals[h.portalId]?.title || "Unknown" : "Unknown";
                const destPortal = h.dest !== undefined ? portals[h.dest]?.title || "Unknown" : "Unknown";
                alignmentMismatches.push({
                    shardId: Number(shardId),
                    time: formatTimeWithMs(h.moveTime, timezone),
                    moveTime: Number(h.moveTime),
                    linkTeam: h.align,
                    originPortal,
                    originTeam: h.mismatch?.originAlign,
                    destPortal,
                    destTeam: h.mismatch?.destAlign,
                });
            }
        }
    }

    return {
        geocode,
        portals,
        waves,
        fullEvent: {
            shards: allShards,
            alignmentMismatches,
        },
    };
}
