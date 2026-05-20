import * as Instant from "temporal-polyfill/fns/instant";
import * as ZonedDateTime from "temporal-polyfill/fns/zoneddatetime";
import { printTable, calculateShardActionSchedule } from "./data-helpers.js";

/**
 * Calculates statistics for the entire season/series.
 * @param {Object} seriesHistory
 * @param {Object} seriesConfig
 * @param {Object} blueprints
 */
export function calculateStatisticsForSeason(seriesHistory, seriesConfig, blueprints) {
    const sites = Object.values(seriesHistory);
    console.log(`ℹ️ Calculating statistics for ${seriesConfig.name}, ${sites.length} sites...`);
    sites.forEach(site => {
        calculateSiteStatistics(site, seriesConfig, blueprints);
    });
    console.log(`ℹ️ Statistics complete.\n`);
}

/**
 * Calculates and displays action timing statistics for a single site.
 * @param {Object} site
 * @param {Object} seriesConfig
 * @param {Object} blueprints
 */
function calculateSiteStatistics(site, seriesConfig, blueprints) {
    if (site.waves?.length > 0 && site.geocode) {
        console.log(`Calculating statistics for site ${site.geocode.id}...`);

        const siteEventType = site.geocode.eventType;
        const componentConfig = seriesConfig.shardComponents?.find(et => et.eventType === siteEventType);
        if (!componentConfig) return;

        const shardMechanic = (blueprints.mechanics?.shards || blueprints.shardMechanics)[componentConfig.shardMechanics];
        if (!shardMechanic) return;

        const shardActionSchedule = calculateShardActionSchedule(shardMechanic, site.geocode);
        const actionStats = {};

        for (const [waveIndex, wave] of site.waves.entries()) {
            const expectedWaveSchedule = [...shardActionSchedule.waves[waveIndex]];

            for (const shard of wave.shards) {
                const scheduleCopy = [...expectedWaveSchedule];

                for (const historyItem of shard.history) {
                    const inst = Instant.fromEpochMilliseconds(Number(historyItem.moveTime));
                    const zonedDateTime = Instant.toZonedDateTimeISO(inst, site.geocode.timezone);

                    const matches = scheduleCopy.map((scheduledItem, index) => {
                        const isActionMatch =
                            (scheduledItem.action === "spawn" && historyItem.reason === "spawn") ||
                            (scheduledItem.action === "despawn" && historyItem.reason === "despawn") ||
                            (scheduledItem.action === "jump" && ["link", "jump", "no move"].includes(historyItem.reason));

                        if (!isActionMatch) return null;

                        const diffMs = Math.abs(
                            ZonedDateTime.epochMilliseconds(zonedDateTime) -
                            ZonedDateTime.epochMilliseconds(scheduledItem.time)
                        );
                        return diffMs <= 1800000 ? { index, diffMs, scheduledItem } : null;
                    }).filter(m => m !== null);

                    if (matches.length > 0) {
                        matches.sort((a, b) => a.diffMs - b.diffMs);
                        const bestMatch = matches[0];
                        const matchedScheduledItem = scheduleCopy.splice(bestMatch.index, 1)[0];
                        const diffMs = ZonedDateTime.epochMilliseconds(zonedDateTime) - ZonedDateTime.epochMilliseconds(matchedScheduledItem.time);

                        const reason = matchedScheduledItem.action;
                        const waveNumber = waveIndex + 1;
                        const scheduledTimeStr = ZonedDateTime.toLocaleString(matchedScheduledItem.time, "en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hourCycle: "h23"
                        });
                        const key = `${waveNumber}_${scheduledTimeStr}_${reason}`;
                        if (!actionStats[key]) {
                            actionStats[key] = {
                                wave: waveNumber,
                                scheduledTimeStr: scheduledTimeStr,
                                scheduledTimeZoned: matchedScheduledItem.time,
                                action: reason,
                                times: [],
                                latencies: []
                            };
                        }
                        actionStats[key].times.push(zonedDateTime);
                        actionStats[key].latencies.push(diffMs);
                    }
                }
            }
        }

        const tableData = [];
        const sortedKeys = Object.keys(actionStats).sort((keyA, keyB) => {
            const statsA = actionStats[keyA];
            const statsB = actionStats[keyB];
            if (statsA.wave !== statsB.wave) {
                return statsA.wave - statsB.wave;
            }
            const timeA = ZonedDateTime.epochMilliseconds(statsA.scheduledTimeZoned);
            const timeB = ZonedDateTime.epochMilliseconds(statsB.scheduledTimeZoned);
            if (timeA !== timeB) {
                return timeA - timeB;
            }
            return statsA.action.localeCompare(statsB.action);
        });

        for (const key of sortedKeys) {
            const stats = actionStats[key];
            if (stats.times.length === 0) continue;

            stats.times.sort((a, b) => ZonedDateTime.epochMilliseconds(a) - ZonedDateTime.epochMilliseconds(b));

            const firstTime = stats.times[0];
            const lastTime = stats.times[stats.times.length - 1];

            const formattedFirst = ZonedDateTime.toLocaleString(firstTime, "en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                fractionalSecondDigits: 3,
                hourCycle: "h23"
            });

            const formattedLast = ZonedDateTime.toLocaleString(lastTime, "en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                fractionalSecondDigits: 3,
                hourCycle: "h23"
            });

            const durationMs = ZonedDateTime.epochMilliseconds(lastTime) - ZonedDateTime.epochMilliseconds(firstTime);
            const avgIntervalMs = durationMs / stats.times.length;
            const avgIntervalSeconds = avgIntervalMs / 1000;
            const intMinutes = Math.floor(Math.abs(avgIntervalSeconds) / 60);
            const intSeconds = Math.abs(avgIntervalSeconds) % 60;
            const formattedIntSeconds = intSeconds.toFixed(1);

            const signInt = avgIntervalSeconds < 0 ? "-" : "";
            const avgIntervalStr = intMinutes > 0 ? `${signInt}${intMinutes}m ${formattedIntSeconds}s` : `${signInt}${formattedIntSeconds}s`;

            const sumLatencyMs = stats.latencies.reduce((sum, val) => sum + Math.abs(val), 0);
            const avgLatencyMs = sumLatencyMs / stats.latencies.length;
            const avgLatencySeconds = avgLatencyMs / 1000;
            const latMinutes = Math.floor(Math.abs(avgLatencySeconds) / 60);
            const latSeconds = Math.abs(avgLatencySeconds) % 60;
            const formattedLatSeconds = latSeconds.toFixed(1);

            const signLat = avgLatencySeconds < 0 ? "-" : "";
            const avgLatencyStr = latMinutes > 0 ? `${signLat}${latMinutes}m ${formattedLatSeconds}s` : `${signLat}${formattedLatSeconds}s`;

            tableData.push({
                "Wave": stats.wave,
                "Scheduled": stats.scheduledTimeStr,
                "Action": stats.action,
                "Count": stats.times.length,
                "First Action": formattedFirst,
                "Last Action": formattedLast,
                "Avg Interval": avgIntervalStr,
                "Avg Latency": avgLatencyStr
            });
        }

        let totalActualActions = 0;
        let totalExpectedActions = 0;
        for (const [waveIndex, wave] of site.waves.entries()) {
            const expectedWaveSchedule = shardActionSchedule.waves[waveIndex];
            for (const shard of wave.shards) {
                totalActualActions += shard.history.length;
                totalExpectedActions += expectedWaveSchedule.length;
            }
        }

        if (tableData.length > 0) {
            printTable(tableData);
            console.log(`Total Actions: ${totalActualActions} / Expected: ${totalExpectedActions}\n`);
        }
    }
}
