import {
    fromEpochMilliseconds as instantFromEpochMilliseconds,
    toZonedDateTimeISO,
} from "temporal-polyfill/fns/Instant";
import { calculateShardActionSchedule, formatTimeWithMs, formatDurationMs, formatZonedDateTimeWithMs, type ShardMechanicBlueprint, type ZonedDateTime } from "./CsvHelpers.js";
import type { AdaptedSiteForValidation } from "./SiteAdapter.js";

export interface ValidationResults {
    missingShardActions: Record<string, unknown>[];
    shardActionsOutsideJumpWindow: Record<string, unknown>[];
    invalidShardSequences: Record<string, unknown>[];
    linkAlignmentMismatches: Record<string, unknown>[];
}

export interface ValidationComponentConfig {
    eventType?: string;
    shardMechanics?: string;
    targetMechanics?: string;
    schedule?: {
        sites?: unknown[];
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}

export interface ValidationSeriesConfig {
    id: string;
    components?: ValidationComponentConfig[];
}

export interface ValidationBlueprintsConfig {
    mechanics?: {
        shards?: Record<string, ShardMechanicBlueprint & { waves?: { quantity?: number; startOffset: number }[] }>;
        targets?: Record<string, unknown>;
    };
    shardMechanics?: Record<string, ShardMechanicBlueprint & { waves?: { quantity?: number; startOffset: number }[] }>;
    targetMechanics?: Record<string, unknown>;
    [key: string]: unknown;
}

interface MissingShardAction {
    action: string;
    time: ZonedDateTime;
    wave: number;
    shardId: number;
}

interface ActionOutsideJumpWindow {
    wave: number;
    shardId: number;
    action: string;
    actualTime: ZonedDateTime;
    scheduledTime: ZonedDateTime;
    diffMs: number;
}

interface InvalidSequenceGroup {
    shardId: number;
    wave: number;
    rows: Record<string, unknown>[];
}

export function validateProcessedSeasonData(
    processedSites: AdaptedSiteForValidation[],
    seriesConfig: ValidationSeriesConfig,
    blueprints: ValidationBlueprintsConfig
): ValidationResults {
    const seriesMissing: Record<string, unknown>[] = [];
    const seriesOutsideWindow: Record<string, unknown>[] = [];
    const seriesInvalidSequences: Record<string, unknown>[] = [];
    const seriesMismatches: Record<string, unknown>[] = [];

    const eventTypeConfigs: Record<string, { shardMechanic?: ShardMechanicBlueprint & { waves?: { quantity?: number; startOffset: number }[] }; targetMechanic?: unknown }> = {};
    const components = seriesConfig.components;
    if (components) {
        components.forEach(componentConfig => {
            if (!componentConfig.eventType) return;
            const shardMechanic = componentConfig.shardMechanics
                ? (blueprints.mechanics?.shards || blueprints.shardMechanics)?.[componentConfig.shardMechanics]
                : undefined;
            const targetMechanic = componentConfig.targetMechanics
                ? (blueprints.mechanics?.targets || blueprints.targetMechanics)?.[componentConfig.targetMechanics]
                : undefined;
            eventTypeConfigs[componentConfig.eventType] = {
                shardMechanic,
                targetMechanic,
            };
        });
    }

    for (const site of processedSites) {
        if (Object.keys(eventTypeConfigs).length === 0 || !site.geocode) continue;

        const siteEventType = site.geocode.eventType;
        const componentConfig = components?.find(et => et.eventType === siteEventType);
        let siteScheduleConfig: { name?: string; shardCounts?: number[] } | undefined;
        for (const sched of componentConfig?.schedule ?? []) {
            const found = (sched.sites as { name?: string; shardCounts?: number[] }[] | undefined)?.find(s => s.name === site.geocode?.name);
            if (found) {
                siteScheduleConfig = found;
                break;
            }
        }

        const eventTypeConfig = eventTypeConfigs[siteEventType];
        if (!eventTypeConfig?.shardMechanic) continue;

        const { shardMechanic } = eventTypeConfig;
        const shardActionSchedule = calculateShardActionSchedule(shardMechanic, site.geocode);

        if (site.waves && shardMechanic.waves) {
            const missingShardActions: MissingShardAction[] = [];
            const shardActionsOutsideJumpWindow: ActionOutsideJumpWindow[] = [];
            const invalidShardSequences: InvalidSequenceGroup[] = [];

            for (const [waveIndex, wave] of site.waves.entries()) {
                const expectedWaveShards = (siteScheduleConfig && siteScheduleConfig.shardCounts)
                    ? siteScheduleConfig.shardCounts[waveIndex]
                    : shardMechanic.waves[waveIndex]?.quantity;

                if (wave.shards?.length !== expectedWaveShards) {
                    console.log(`⚠️ Site ${site.geocode.id}: wave ${waveIndex + 1} has ${wave.shards?.length || 0} shards, but ${expectedWaveShards} expected.`);
                }

                for (const shard of wave.shards ?? []) {
                    const expectedWaveSchedule = [...(shardActionSchedule.waves[waveIndex] ?? [])];
                    if (shard.history?.length !== expectedWaveSchedule.length) {
                        for (const historyItem of shard.history ?? []) {
                            const action = historyItem.action || historyItem.reason;
                            const inst = instantFromEpochMilliseconds(Number(historyItem.moveTime));
                            const zonedDateTime = toZonedDateTimeISO(inst, site.geocode.timezone);

                            const expectedIndex = expectedWaveSchedule.findIndex(wsa => {
                                const actionMatches = (
                                    (wsa.action === "spawn" && action === "spawn") ||
                                    (wsa.action === "despawn" && action === "despawn") ||
                                    (wsa.action === "jump" && ["jump", "link", "no move"].includes(action ?? ""))
                                );
                                if (!actionMatches) return false;
                                return Math.abs(zonedDateTime.epochMilliseconds - wsa.time.epochMilliseconds) <= 60000;
                            });
                            if (expectedIndex !== -1) {
                                expectedWaveSchedule.splice(expectedIndex, 1);
                            }
                        }
                        for (const scheduleItem of expectedWaveSchedule) {
                            if (scheduleItem.action !== "despawn") {
                                missingShardActions.push({ ...scheduleItem, wave: waveIndex + 1, shardId: shard.id });
                            }
                        }
                    } else {
                        for (let i = 0; i < expectedWaveSchedule.length; i++) {
                            const historyItem = shard.history[i]!;
                            const scheduledItem = expectedWaveSchedule[i]!;
                            const action = historyItem.action || historyItem.reason;
                            const inst = instantFromEpochMilliseconds(Number(historyItem.moveTime));
                            const zonedDateTime = toZonedDateTimeISO(inst, site.geocode.timezone);

                            const actionMatches = (
                                (scheduledItem.action === "spawn" && action === "spawn") ||
                                (scheduledItem.action === "jump" && ["jump", "link", "no move"].includes(action ?? ""))
                            );

                            if (actionMatches) {
                                const diffMs = Math.abs(zonedDateTime.epochMilliseconds - scheduledItem.time.epochMilliseconds);
                                if (diffMs > 60000) {
                                    shardActionsOutsideJumpWindow.push({
                                        wave: waveIndex + 1,
                                        shardId: shard.id,
                                        action: action ?? "",
                                        actualTime: zonedDateTime,
                                        scheduledTime: scheduledItem.time,
                                        diffMs,
                                    });
                                }
                            }
                        }
                    }

                    // Chronological sequence validation
                    let currentLocationId: string | null = null;
                    let hasMismatch = false;
                    const allRows: Record<string, unknown>[] = [];

                    for (const historyItem of shard.history ?? []) {
                        const action = historyItem.action || historyItem.reason;
                        const originPortal = historyItem.portalId !== undefined ? site.portals?.[Number(historyItem.portalId)] : null;
                        const destPortal = historyItem.dest !== undefined ? site.portals?.[Number(historyItem.dest)] : null;
                        let isMismatch = false;
                        let originStr = "-";
                        let destStr = "-";

                        if (action === "spawn") {
                            destStr = originPortal?.title || "Unknown";
                            currentLocationId = historyItem.portalId ?? null;
                        } else if (action === "link" || action === "jump") {
                            if (currentLocationId !== null && historyItem.portalId !== undefined && currentLocationId !== historyItem.portalId) {
                                hasMismatch = true;
                                isMismatch = true;
                            }
                            originStr = originPortal?.title || "Unknown";
                            destStr = destPortal?.title || "Unknown";
                            if (historyItem.dest !== undefined) currentLocationId = historyItem.dest;
                        } else if (action === "despawn") {
                            if (currentLocationId !== null && historyItem.portalId !== undefined && currentLocationId !== historyItem.portalId) {
                                hasMismatch = true;
                                isMismatch = true;
                            }
                            originStr = originPortal?.title || "Unknown";
                            currentLocationId = null;
                        } else if (action === "no move") {
                            if (currentLocationId !== null && historyItem.portalId !== undefined && currentLocationId !== historyItem.portalId) {
                                hasMismatch = true;
                                isMismatch = true;
                            }
                            originStr = originPortal?.title || "Unknown";
                            if (historyItem.portalId !== undefined) currentLocationId = historyItem.portalId;
                        }

                        allRows.push({
                            Season: seriesConfig.id,
                            Site: site.geocode.id,
                            Wave: waveIndex + 1,
                            "Shard ID": shard.id,
                            Action: action,
                            Valid: isMismatch ? 0 : 1,
                            Origin: originStr,
                            Destination: destStr,
                            "Link Time": historyItem.linkTime ? formatTimeWithMs(historyItem.linkTime, site.geocode.timezone) : "-",
                            "Move Time": formatTimeWithMs(historyItem.moveTime, site.geocode.timezone),
                        });
                    }

                    if (hasMismatch) {
                        invalidShardSequences.push({ shardId: shard.id, wave: waveIndex + 1, rows: allRows });
                    }
                }
            }

            if (missingShardActions.length > 0) {
                missingShardActions.sort((a, b) => a.time.epochMilliseconds - b.time.epochMilliseconds || a.shardId - b.shardId);
                seriesMissing.push(...missingShardActions.map(a => ({
                    Season: seriesConfig.id,
                    Site: site.geocode?.id,
                    Wave: a.wave,
                    "Shard ID": a.shardId,
                    Action: a.action,
                    Scheduled: formatZonedDateTimeWithMs(a.time),
                })));
            }

            if (shardActionsOutsideJumpWindow.length > 0) {
                shardActionsOutsideJumpWindow.sort((a, b) => a.actualTime.epochMilliseconds - b.actualTime.epochMilliseconds);
                seriesOutsideWindow.push(...shardActionsOutsideJumpWindow.map(a => ({
                    Season: seriesConfig.id,
                    Site: site.geocode?.id,
                    Wave: a.wave,
                    "Shard ID": a.shardId,
                    Action: a.action,
                    Scheduled: formatZonedDateTimeWithMs(a.scheduledTime),
                    Actual: formatZonedDateTimeWithMs(a.actualTime),
                    Delta: formatDurationMs(a.diffMs, false),
                })));
            }

            if (invalidShardSequences.length > 0) {
                invalidShardSequences.sort((a, b) => a.wave - b.wave || a.shardId - b.shardId);
                for (const seq of invalidShardSequences) seriesInvalidSequences.push(...seq.rows);
            }
        }

        if (site.fullEvent?.alignmentMismatches?.length > 0) {
            const tableData = site.fullEvent.alignmentMismatches.map(mismatch => {
                const waveIndex = site.waves ? site.waves.findIndex(w => w.shards?.some(s => s.id === mismatch.shardId)) : -1;
                const waveNumber = waveIndex !== -1 ? waveIndex + 1 : 1;
                return {
                    Season: seriesConfig.id,
                    Site: site.geocode?.id,
                    Wave: waveNumber,
                    "Shard ID": mismatch.shardId,
                    Time: mismatch.time,
                    "Origin Portal": mismatch.originPortal,
                    "Destination Portal": mismatch.destPortal,
                    "Origin Team": mismatch.originTeam,
                    "Link Team": mismatch.linkTeam,
                    "Destination Team": mismatch.destTeam,
                };
            });
            seriesMismatches.push(...tableData);
        }
    }

    return {
        missingShardActions: seriesMissing,
        shardActionsOutsideJumpWindow: seriesOutsideWindow,
        invalidShardSequences: seriesInvalidSequences,
        linkAlignmentMismatches: seriesMismatches,
    };
}
