import {
    fromEpochMilliseconds as instantFromEpochMilliseconds,
    toZonedDateTimeISO,
} from "temporal-polyfill/fns/Instant";
import { toLocaleString as zdtToLocaleString } from "temporal-polyfill/fns/ZonedDateTime";
import { calculateShardActionSchedule, formatZonedDateTimeWithMs, formatDurationMs, type ScheduledActionItem, type ShardMechanicBlueprint, type ZonedDateTime } from "./CsvHelpers.js";
import type { AdaptedSiteForValidation } from "./SiteAdapter.js";

export interface SeriesComponentConfig {
    eventType?: string;
    shardMechanics?: string;
    targetMechanics?: string;
    [key: string]: unknown;
}

export interface SeriesConfig {
    id: string;
    components?: SeriesComponentConfig[];
}

export interface BlueprintsConfig {
    mechanics?: {
        shards?: Record<string, ShardMechanicBlueprint>;
        targets?: Record<string, unknown>;
    };
    shardMechanics?: Record<string, ShardMechanicBlueprint>;
    [key: string]: unknown;
}

interface ActionStat {
    wave: number;
    scheduledTimeStr: string;
    scheduledTimeZoned: ZonedDateTime;
    action: string;
    times: ZonedDateTime[];
    latencies: number[];
}

export function calculateStatisticsForSeason(
    processedSites: AdaptedSiteForValidation[],
    seriesConfig: SeriesConfig,
    blueprints: BlueprintsConfig
): Record<string, unknown>[] {
    const allStats: Record<string, unknown>[] = [];
    for (const site of processedSites) {
        const siteStats = calculateSiteStatistics(site, seriesConfig, blueprints);
        if (siteStats) {
            allStats.push(...siteStats);
        }
    }
    return allStats;
}

function calculateSiteStatistics(
    site: AdaptedSiteForValidation,
    seriesConfig: SeriesConfig,
    blueprints: BlueprintsConfig
): Record<string, unknown>[] | null {
    if (!site.waves || site.waves.length === 0 || !site.geocode) return null;

    const siteEventType = site.geocode.eventType;
    const componentConfig = seriesConfig.components?.find(et => et.eventType === siteEventType);
    if (!componentConfig || !componentConfig.shardMechanics) return null;

    const shardMechanic = (blueprints.mechanics?.shards || blueprints.shardMechanics)?.[componentConfig.shardMechanics];
    if (!shardMechanic) return null;

    const shardActionSchedule = calculateShardActionSchedule(shardMechanic, site.geocode);
    const actionStats: Record<string, ActionStat> = {};

    if (!site.waves) return null;

    for (const [waveIndex, wave] of site.waves.entries()) {
        const expectedWaveSchedule = [...(shardActionSchedule.waves[waveIndex] ?? [])];

        for (const shard of wave.shards ?? []) {
            const scheduleCopy = [...expectedWaveSchedule];

            for (const historyItem of shard.history ?? []) {
                const action = historyItem.action || historyItem.reason;
                const inst = instantFromEpochMilliseconds(Number(historyItem.moveTime));
                const zonedDateTime = toZonedDateTimeISO(inst, site.geocode.timezone);

                const matches = scheduleCopy.map((scheduledItem, index) => {
                    const isActionMatch =
                        (scheduledItem.action === "spawn" && action === "spawn") ||
                        (scheduledItem.action === "despawn" && action === "despawn") ||
                        (scheduledItem.action === "jump" && ["link", "jump", "no move"].includes(action ?? ""));

                    if (!isActionMatch) return null;

                    const diffMs = Math.abs(zonedDateTime.epochMilliseconds - scheduledItem.time.epochMilliseconds);
                    return diffMs <= 1800000 ? { index, diffMs, scheduledItem } : null;
                }).filter((m): m is { index: number; diffMs: number; scheduledItem: ScheduledActionItem } => m !== null);

                if (matches.length > 0) {
                    matches.sort((a, b) => a.diffMs - b.diffMs);
                    const bestMatch = matches[0]!;
                    const matchedScheduledItem = scheduleCopy.splice(bestMatch.index, 1)[0]!;
                    const diffMs = zonedDateTime.epochMilliseconds - matchedScheduledItem.time.epochMilliseconds;

                    const reason = matchedScheduledItem.action;
                    const waveNumber = waveIndex + 1;
                    const scheduledTimeStr = zdtToLocaleString(matchedScheduledItem.time, "en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                    });
                    const key = `${waveNumber}_${scheduledTimeStr}_${reason}`;
                    if (!actionStats[key]) {
                        actionStats[key] = {
                            wave: waveNumber,
                            scheduledTimeStr,
                            scheduledTimeZoned: matchedScheduledItem.time,
                            action: reason,
                            times: [],
                            latencies: [],
                        };
                    }
                    actionStats[key].times.push(zonedDateTime);
                    actionStats[key].latencies.push(diffMs);
                }
            }
        }
    }

    const tableData: Record<string, unknown>[] = [];
    const sortedKeys = Object.keys(actionStats).sort((keyA, keyB) => {
        const statsA = actionStats[keyA]!;
        const statsB = actionStats[keyB]!;
        if (statsA.wave !== statsB.wave) return statsA.wave - statsB.wave;
        const timeA = statsA.scheduledTimeZoned.epochMilliseconds;
        const timeB = statsB.scheduledTimeZoned.epochMilliseconds;
        if (timeA !== timeB) return timeA - timeB;
        return statsA.action.localeCompare(statsB.action);
    });

    for (const key of sortedKeys) {
        const stats = actionStats[key]!;
        if (stats.times.length === 0) continue;

        stats.times.sort((a, b) => a.epochMilliseconds - b.epochMilliseconds);
        const count = stats.times.length;
        const firstAction = stats.times[0];
        const lastAction = stats.times[count - 1];

        let avgIntervalStr = "-";
        if (count > 1 && lastAction && firstAction) {
            const spanMs = lastAction.epochMilliseconds - firstAction.epochMilliseconds;
            const avgIntervalMs = spanMs / count;
            avgIntervalStr = formatDurationMs(avgIntervalMs);
        }

        const avgLatencyMs = stats.latencies.reduce((a: number, b: number) => a + Math.abs(b), 0) / count;
        const avgLatencyStr = formatDurationMs(avgLatencyMs);

        tableData.push({
            Season: seriesConfig.id,
            Site: site.geocode.id,
            Wave: stats.wave,
            Scheduled: stats.scheduledTimeStr,
            Action: stats.action,
            Count: count,
            "First Action": formatZonedDateTimeWithMs(firstAction),
            "Last Action": formatZonedDateTimeWithMs(lastAction),
            "Avg Interval": avgIntervalStr,
            "Avg Latency": avgLatencyStr,
        });
    }

    return tableData;
}
