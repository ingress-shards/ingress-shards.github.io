import * as Instant from "temporal-polyfill/fns/instant";
import * as ZonedDateTime from "temporal-polyfill/fns/zoneddatetime";

import { FACTION_COLORS } from "../../constants.js";
import { printTable, calculateShardActionSchedule } from "./data-helpers.js";

const INDENT = '    ';

export function validateProcessedSeriesData(processedSeriesData, seriesConfig, blueprints, verbose = false) {
    console.log(`ℹ️ Validating processed data: ${seriesConfig.name}, ${Object.keys(processedSeriesData).length} sites...`);
    const processedSites = Object.values(processedSeriesData);
    validateSites(processedSites, seriesConfig, blueprints, verbose);
    console.log(`ℹ️ Validation complete.\n`);
}

function validateSites(processedSites, seriesConfig, blueprints, verbose = false) {
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
                            const actionDetails = [];

                            for (const historyItem of shard.history) {
                                const originPortal = historyItem.portalId !== undefined ? site.portals[historyItem.portalId] : null;
                                const destPortal = historyItem.dest !== undefined ? site.portals[historyItem.dest] : null;

                                let detailStr = "";
                                if (historyItem.reason === "spawn") {
                                    detailStr = `   spawn => "${originPortal?.title || 'Unknown'}"`;
                                    currentLocationId = historyItem.portalId;
                                } else if (historyItem.reason === "link" || historyItem.reason === "jump") {
                                    let isMismatch = false;
                                    if (currentLocationId !== null && historyItem.portalId !== undefined) {
                                        if (currentLocationId !== historyItem.portalId) {
                                            hasJumpMismatch = true;
                                            isMismatch = true;
                                        }
                                    }
                                    if (isMismatch) {
                                        detailStr = `❌ \x1b[31m"${originPortal?.title || 'Unknown'}"\x1b[0m => "${destPortal?.title || 'Unknown'}"`;
                                    } else {
                                        detailStr = `   "${originPortal?.title || 'Unknown'}" => "${destPortal?.title || 'Unknown'}"`;
                                    }
                                    if (historyItem.dest !== undefined) {
                                        currentLocationId = historyItem.dest;
                                    }
                                } else if (historyItem.reason === "despawn") {
                                    let isMismatch = false;
                                    if (currentLocationId !== null && historyItem.portalId !== undefined) {
                                        if (currentLocationId !== historyItem.portalId) {
                                            hasDespawnMismatch = true;
                                            isMismatch = true;
                                        }
                                    }
                                    if (isMismatch) {
                                        detailStr = `❌ \x1b[31m"${originPortal?.title || 'Unknown'}"\x1b[0m => despawn`;
                                    } else {
                                        detailStr = `   "${originPortal?.title || 'Unknown'}" => despawn`;
                                    }
                                    currentLocationId = null;
                                }

                                if (detailStr) {
                                    actionDetails.push(detailStr);
                                }
                            }

                            if (hasJumpMismatch) {
                                invalidShardSequences.push({
                                    shardId: shard.id,
                                    wave: waveIndex + 1,
                                    details: actionDetails
                                });
                            } else if (hasDespawnMismatch) {
                                invalidDespawnsCount++;
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

                        console.log(`⚠️ Site ${site.geocode.id}: has ${missingShardActions.length} missing shard actions:`);
                        const tableData = missingShardActions.map(action => {
                            const formattedTime = ZonedDateTime.toLocaleString(action.time, 'en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hourCycle: 'h23'
                            });
                            return {
                                'Wave': action.wave,
                                'Shard ID': action.shardId,
                                'Action': action.action,
                                'Scheduled at': formattedTime
                            };
                        });
                        printTable(tableData);
                    }
                    if (shardActionsOutsideJumpWindow.length > 0) {
                        shardActionsOutsideJumpWindow.sort((a, b) => {
                            return ZonedDateTime.epochMilliseconds(a.actualTime) - ZonedDateTime.epochMilliseconds(b.actualTime);
                        });

                        console.log(`⚠️ Site ${site.geocode.id}: has ${shardActionsOutsideJumpWindow.length} shard actions outside the expected 1-minute window:`);
                        const tableData = shardActionsOutsideJumpWindow.map(action => {
                            const formattedActualTime = ZonedDateTime.toLocaleString(action.actualTime, 'en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hourCycle: 'h23'
                            });
                            const formattedScheduledTime = ZonedDateTime.toLocaleString(action.scheduledTime, 'en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hourCycle: 'h23'
                            });
                            const totalSeconds = Math.round(action.diffMs / 1000);
                            const minutes = Math.floor(totalSeconds / 60);
                            const seconds = totalSeconds % 60;
                            const offByStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

                            return {
                                'Wave': action.wave,
                                'Shard ID': action.shardId,
                                'Action': action.action,
                                'Scheduled': formattedScheduledTime,
                                'Actual': formattedActualTime,
                                'Delta': offByStr
                            };
                        });
                        printTable(tableData);
                    }
                    if (invalidShardSequences.length > 0) {
                        console.log(`⚠️ Site ${site.geocode.id}: has ${invalidShardSequences.length} invalid shard jump sequences:`);
                        const sequencesByWave = {};
                        for (const seq of invalidShardSequences) {
                            if (!sequencesByWave[seq.wave]) {
                                sequencesByWave[seq.wave] = [];
                            }
                            sequencesByWave[seq.wave].push(seq);
                        }

                        const sortedWaves = Object.keys(sequencesByWave).sort((a, b) => Number(a) - Number(b));
                        for (const waveNum of sortedWaves) {
                            console.log(`${INDENT}- Wave ${waveNum}:`);
                            for (const seq of sequencesByWave[waveNum]) {
                                const header = `Shard ${seq.shardId}: `;
                                console.log(`${INDENT}${INDENT}${header}${seq.details[0]}`);
                                const padding = " ".repeat(header.length);
                                seq.details.slice(1).forEach(detail => {
                                    console.log(`${INDENT}${INDENT}${padding}${detail}`);
                                });
                            }
                        }
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

                if (shardPath.links && shardPath.links.length > 0) {
                    const moveOrigins = new Set(shardPath.links.flatMap(link => link.moves).map(move => move.origin));
                    const biDirectionalMoves = moveOrigins.size > 1;
                    const sortedLinks = shardPath.links.sort((a, b) => a.linkTime - b.linkTime);

                    let linkColor;
                    let previousTeam;
                    for (const [, link] of sortedLinks.entries()) {
                        if (linkColor && FACTION_COLORS[link.team] !== linkColor) {
                            const [portalAKey, portalBKey] = shardPathKey.split('-');
                            const portalA = site.portals[portalAKey];
                            const portalB = site.portals[portalBKey];

                            const biDirMessage = biDirectionalMoves ? `\n${INDENT}Note: There are bidirectional jumps too!` : '';
                            const siteHeader = `⚠️ Site ${site.geocode.id}: New link with different team!`;
                            if (verbose) {
                                console.warn(`${siteHeader}
${INDENT}Portal A: ${portalA.title} (${portalA.lat},${portalA.lng})
${INDENT}Portal B: ${portalB.title} (${portalB.lat},${portalB.lng})
${INDENT}Previous ${previousTeam}, Current ${link.team}${biDirMessage}`);
                            } else {
                                console.warn(siteHeader);
                            }
                        }
                        linkColor = FACTION_COLORS[link.team] || FACTION_COLORS.NEU;
                        previousTeam = link.team;
                    }
                }
            }
        }
    }

}