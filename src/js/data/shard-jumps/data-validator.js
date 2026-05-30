import * as Instant from "temporal-polyfill/fns/instant";
import * as ZonedDateTime from "temporal-polyfill/fns/zoneddatetime";

import { FACTION_COLORS } from "../../constants.js";
import { calculateShardActionSchedule, convertToCsv, formatTimeWithMs, formatDurationMs, formatZonedDateTimeWithMs } from "./data-helpers.js";

const INDENT = '    ';


export function validateProcessedSeriesData(processedSeriesData, seriesConfig, blueprints, verbose = false) {
    console.log(`ℹ️ Validating processed data: ${seriesConfig.name}, ${Object.keys(processedSeriesData).length} sites...`);
    const processedSites = Object.values(processedSeriesData);
    const results = validateSites(processedSites, seriesConfig, blueprints, verbose);
    console.log(`ℹ️ Validation complete.\n`);
    return results;
}

function validateSites(processedSites, seriesConfig, blueprints, verbose = false) {
    const seriesMissing = [];
    const seriesOutsideWindow = [];
    const seriesInvalidSequences = [];
    const seriesMismatches = [];

    const seriesValidation = {
        eventTypeConfigs: {},
    };

    if (seriesConfig.shardComponents) {
        seriesConfig.shardComponents.forEach(componentConfig => {
            const shardMechanic = (blueprints.mechanics?.shards || blueprints.shardMechanics)[componentConfig.shardMechanics];
            const targetMechanic = (blueprints.mechanics?.targets || blueprints.targetMechanics)[componentConfig.targetMechanics];

            const totalShards = shardMechanic?.waves.reduce((sum, wave) => sum + (wave.quantity || 0), 0) || 0;

            const totalTargets =
                targetMechanic?.waves.reduce((sum, wave) => {
                    const factions = wave.factionQuantity || {};
                    const waveTotal = Object.values(factions).reduce((a, b) => a + b, 0);
                    return sum + waveTotal;
                }, 0) || 0;

            seriesValidation.eventTypeConfigs[componentConfig.eventType] = {
                shardMechanic,
                targetMechanic,
                totalShards,
                totalTargets,
            };
        });
    }

    for (const site of processedSites) {
        if (Object.entries(seriesValidation.eventTypeConfigs).length > 0) {
            const siteEventType = site.geocode.eventType;
            const componentConfig = seriesConfig.shardComponents?.find(et => et.eventType === siteEventType);

            // Resolve site override
            let siteConfig = null;
            componentConfig?.schedule?.forEach(sched => {
                const found = sched.sites?.find(s => s.name === site.geocode.name);
                if (found) siteConfig = found;
            });

            const eventTypeConfig = seriesValidation.eventTypeConfigs[siteEventType];
            if (eventTypeConfig) {
                const { shardMechanic, targetMechanic, totalShards, totalTargets } = eventTypeConfig;

                const shardActionSchedule = calculateShardActionSchedule(shardMechanic, site.geocode);

                // Calculate expected shards (with per-site wave overrides support)
                const expectedShards = (siteConfig && siteConfig.shardCounts)
                    ? siteConfig.shardCounts.reduce((sum, count) => sum + count, 0)
                    : totalShards;

                if (site.fullEvent && site.fullEvent?.shards?.length !== expectedShards) {
                    console.log(`⚠️ Site ${site.geocode.id}: expected ${expectedShards} shards but ${site.fullEvent?.shards?.length} found.`)
                }
                if (site.fullEvent?.targets) {
                    const foundTargetsCount = Object.values(site.fullEvent?.targets)?.flat()?.length;
                    if (foundTargetsCount !== totalTargets && totalTargets > 0) {
                        if (targetMechanic) {
                            const lastWave = targetMechanic.waves?.[targetMechanic.waves.length - 1];
                            const durationMins = lastWave ? (lastWave.endOffset + 1) : 241;

                            const [isoPart] = site.geocode.date.split('[');
                            const siteStartTime = new Date(isoPart).getTime();
                            const siteEndTime = siteStartTime + durationMins * 60000;

                            if (Date.now() > siteEndTime && site.hasTargetData) {
                                console.log(`⚠️ Site ${site.geocode.id}: expected ${totalTargets} targets but ${foundTargetsCount} found.`)
                            }
                        }
                    }
                }
                if (site.waves && shardMechanic.waves) {
                    if (site.waves.length !== shardMechanic.waves.length) {
                        console.log(`⚠️ Site ${site.geocode.id}: has ${site.waves.length} waves, but ${shardMechanic.waves.length} expected.`);
                    }
                    let missingShardActions = [];
                    let shardActionsOutsideJumpWindow = [];
                    let invalidShardSequences = [];
                    let invalidDespawnsCount = 0;
                    for (const [waveIndex, wave] of site.waves.entries()) {
                        const expectedWaveShards = (siteConfig && siteConfig.shardCounts) ? siteConfig.shardCounts[waveIndex] : shardMechanic.waves[waveIndex].quantity;
                        if (wave.shards.length !== expectedWaveShards) {
                            console.log(`⚠️ Site ${site.geocode.id}: wave ${waveIndex + 1} has ${wave.shards.length} shards, but ${expectedWaveShards} expected.`);
                        }

                        for (const shard of wave.shards) {
                            const expectedWaveSchedule = [...shardActionSchedule.waves[waveIndex]];
                            if (shard.history.length !== expectedWaveSchedule.length) {
                                for (const historyItem of shard.history) {
                                    const inst = Instant.fromEpochMilliseconds(Number(historyItem.moveTime));
                                    const zonedDateTime = Instant.toZonedDateTimeISO(inst, site.geocode.timezone);

                                    const expectedIndex = expectedWaveSchedule.findIndex(wsa => {
                                        const actionMatches = (
                                            (wsa.action === "spawn" && historyItem.reason === "spawn") ||
                                            (wsa.action === "despawn" && historyItem.reason === "despawn") ||
                                            (wsa.action === "jump" && ["jump", "link", "no move"].includes(historyItem.reason))
                                        );
                                        if (!actionMatches) return false;

                                        const actualMs = ZonedDateTime.epochMilliseconds(zonedDateTime);
                                        const scheduledMs = ZonedDateTime.epochMilliseconds(wsa.time);
                                        return Math.abs(actualMs - scheduledMs) <= 60000;
                                    });
                                    if (expectedIndex !== -1) {
                                        expectedWaveSchedule.splice(expectedIndex, 1);
                                    }
                                }
                                if (expectedWaveSchedule.length > 0) {
                                    for (const scheduleItem of expectedWaveSchedule) {
                                        if (scheduleItem.action !== "despawn") {
                                            missingShardActions.push({
                                                ...scheduleItem,
                                                wave: waveIndex + 1,
                                                shardId: shard.id
                                            });
                                        }
                                    }
                                }
                            } else {
                                for (let i = 0; i < expectedWaveSchedule.length; i++) {
                                    const historyItem = shard.history[i];
                                    const scheduledItem = expectedWaveSchedule[i];

                                    const inst = Instant.fromEpochMilliseconds(Number(historyItem.moveTime));
                                    const zonedDateTime = Instant.toZonedDateTimeISO(inst, site.geocode.timezone);

                                    const actionMatches = (
                                        (scheduledItem.action === "spawn" && historyItem.reason === "spawn") ||
                                        (scheduledItem.action === "jump" && ["jump", "link", "no move"].includes(historyItem.reason))
                                    );

                                    if (actionMatches) {
                                        const actualMs = ZonedDateTime.epochMilliseconds(zonedDateTime);
                                        const scheduledMs = ZonedDateTime.epochMilliseconds(scheduledItem.time);
                                        const diffMs = Math.abs(actualMs - scheduledMs);
                                        if (diffMs > 60000) {
                                            shardActionsOutsideJumpWindow.push({
                                                wave: waveIndex + 1,
                                                shardId: shard.id,
                                                action: historyItem.reason,
                                                actualTime: zonedDateTime,
                                                scheduledTime: scheduledItem.time,
                                                diffMs: diffMs
                                            });
                                        }
                                    }
                                }
                            }

                            // Chronological location integrity check
                            let currentLocationId = null;
                            let hasJumpMismatch = false;
                            let hasDespawnMismatch = false;
                            const allRows = [];

                            for (const historyItem of shard.history) {
                                const originPortal = historyItem.portalId !== undefined ? site.portals[historyItem.portalId] : null;
                                const destPortal = historyItem.dest !== undefined ? site.portals[historyItem.dest] : null;

                                let isMismatch = false;
                                let originStr = "-";
                                let destStr = "-";

                                if (historyItem.reason === "spawn") {
                                    destStr = originPortal?.title || 'Unknown';
                                    currentLocationId = historyItem.portalId;
                                } else if (historyItem.reason === "link" || historyItem.reason === "jump") {
                                    if (currentLocationId !== null && historyItem.portalId !== undefined) {
                                        if (currentLocationId !== historyItem.portalId) {
                                            hasJumpMismatch = true;
                                            isMismatch = true;
                                        }
                                    }
                                    originStr = originPortal?.title || 'Unknown';
                                    destStr = destPortal?.title || 'Unknown';
                                    if (historyItem.dest !== undefined) {
                                        currentLocationId = historyItem.dest;
                                    }
                                } else if (historyItem.reason === "despawn") {
                                    if (currentLocationId !== null && historyItem.portalId !== undefined) {
                                        if (currentLocationId !== historyItem.portalId) {
                                            hasDespawnMismatch = true;
                                            isMismatch = true;
                                        }
                                    }
                                    originStr = originPortal?.title || 'Unknown';
                                    destStr = "-";
                                    currentLocationId = null;
                                } else if (historyItem.reason === "no move") {
                                    if (currentLocationId !== null && historyItem.portalId !== undefined) {
                                        if (currentLocationId !== historyItem.portalId) {
                                            hasJumpMismatch = true;
                                            isMismatch = true;
                                        }
                                    }
                                    originStr = originPortal?.title || 'Unknown';
                                    destStr = "-";
                                    if (historyItem.portalId !== undefined) {
                                        currentLocationId = historyItem.portalId;
                                    }
                                }

                                const moveTimeStr = formatTimeWithMs(historyItem.moveTime, site.geocode.timezone);
                                const linkTimeStr = historyItem.linkTime ? formatTimeWithMs(historyItem.linkTime, site.geocode.timezone) : "-";

                                const row = {
                                    'Season': seriesConfig.id,
                                    'Site': site.geocode.id,
                                    'Wave': waveIndex + 1,
                                    'Shard ID': shard.id,
                                    'Action': historyItem.reason,
                                    'Valid': isMismatch ? 0 : 1,
                                    'Origin': originStr,
                                    'Destination': destStr,
                                    'Link Time': linkTimeStr,
                                    'Move Time': moveTimeStr
                                };

                                allRows.push(row);
                            }

                            if (hasJumpMismatch || hasDespawnMismatch) {
                                invalidShardSequences.push({
                                    shardId: shard.id,
                                    wave: waveIndex + 1,
                                    rows: allRows
                                });
                            }
                        }
                    }
                    if (missingShardActions.length > 0) {
                        missingShardActions.sort((a, b) => {
                            const timeA = ZonedDateTime.epochMilliseconds(a.time);
                            const timeB = ZonedDateTime.epochMilliseconds(b.time);
                            if (timeA !== timeB) {
                                return timeA - timeB;
                            }
                            return a.shardId - b.shardId;
                        });

                        console.log(`⚠️ Site ${site.geocode.id}: has ${missingShardActions.length} missing shard actions.`);
                        const tableData = missingShardActions.map(action => {
                            const formattedTime = formatZonedDateTimeWithMs(action.time);
                            return {
                                'Season': seriesConfig.id,
                                'Site': site.geocode.id,
                                'Wave': action.wave,
                                'Shard ID': action.shardId,
                                'Action': action.action,
                                'Scheduled': formattedTime
                            };
                        });
                        seriesMissing.push(...tableData);
                    }
                    if (shardActionsOutsideJumpWindow.length > 0) {
                        shardActionsOutsideJumpWindow.sort((a, b) => {
                            return ZonedDateTime.epochMilliseconds(a.actualTime) - ZonedDateTime.epochMilliseconds(b.actualTime);
                        });

                        console.log(`⚠️ Site ${site.geocode.id}: has ${shardActionsOutsideJumpWindow.length} shard actions outside the expected 1-minute window.`);
                        const tableData = shardActionsOutsideJumpWindow.map(action => {
                            const formattedActualTime = formatZonedDateTimeWithMs(action.actualTime);
                            const formattedScheduledTime = formatZonedDateTimeWithMs(action.scheduledTime);
                            const offByStr = formatDurationMs(action.diffMs, false);

                            return {
                                'Season': seriesConfig.id,
                                'Site': site.geocode.id,
                                'Wave': action.wave,
                                'Shard ID': action.shardId,
                                'Action': action.action,
                                'Scheduled': formattedScheduledTime,
                                'Actual': formattedActualTime,
                                'Delta': offByStr
                            };
                        });
                        seriesOutsideWindow.push(...tableData);
                    }
                    if (invalidShardSequences.length > 0) {
                        console.log(`⚠️ Site ${site.geocode.id}: has ${invalidShardSequences.length} invalid shard jump sequences.`);
                        const tableData = [];
                        invalidShardSequences.sort((a, b) => {
                            if (a.wave !== b.wave) return a.wave - b.wave;
                            return a.shardId - b.shardId;
                        });
                        for (const seq of invalidShardSequences) {
                            tableData.push(...seq.rows);
                        }
                        seriesInvalidSequences.push(...tableData);
                    }
                    if (invalidDespawnsCount > 0) {
                        console.log(`⚠️ Site ${site.geocode.id}: has ${invalidDespawnsCount} invalid despawn actions.`);
                    }
                }
            }
        }

        if (site.fullEvent) {
            for (const [shardPathKey, shardPath] of Object.entries(site.fullEvent.shardPaths)) {
                if (shardPath.links && shardPath.jumps && shardPath.links.length > 0 && shardPath.jumps.length > 0) {
                    console.log(`⚠️ Site ${site.geocode.id}: Shard path ${shardPathKey} with ${shardPath.links.length} links and ${shardPath.jumps.length}.`);
                }
                if (shardPath.jumps && shardPath.jumps.length > 1) {
                    console.log(`⚠️ Site ${site.geocode.id}: ${shardPath.jumps.length} random teleports in shard path ${shardPathKey}.`);
                }


            }
        }

        if (site.fullEvent?.alignmentMismatches?.length > 0) {
            const tableData = site.fullEvent.alignmentMismatches.map(mismatch => {
                const waveIndex = site.waves ? site.waves.findIndex(w => w.shards.some(s => s.id === mismatch.shardId)) : -1;
                const waveNumber = waveIndex !== -1 ? waveIndex + 1 : 1;
                return {
                    'Season': seriesConfig.id,
                    'Site': site.geocode.id,
                    'Wave': waveNumber,
                    'Shard ID': mismatch.shardId,
                    'Time': mismatch.time,
                    'Origin Portal': mismatch.originPortal,
                    'Destination Portal': mismatch.destPortal,
                    'Origin Team': mismatch.originTeam,
                    'Link Team': mismatch.linkTeam,
                    'Destination Team': mismatch.destTeam
                };
            });
            seriesMismatches.push(...tableData);
        }
    }

    return {
        missingShardActions: seriesMissing,
        shardActionsOutsideJumpWindow: seriesOutsideWindow,
        invalidShardSequences: seriesInvalidSequences,
        linkAlignmentMismatches: seriesMismatches
    };
}