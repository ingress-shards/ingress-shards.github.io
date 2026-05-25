import * as ZonedDateTime from "temporal-polyfill/fns/zoneddatetime";
import * as Duration from "temporal-polyfill/fns/duration";
import * as Instant from "temporal-polyfill/fns/instant";
import { HISTORY_REASONS } from "../../constants.js";
import { truncateToDecimalPlaces } from "../../shared/math-helpers.js";

/**
 * This provides the primary information required for a shard,
 * primarily the location and time. Since some shards are "reused"
 * in anomalies, we order the history first so we get the most
 * recent spawn entry - we aren't interested in the second use.
 */
function getSpawnHistoryItemForFragment(fragment) {
    return fragment.history
        .sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))
        .find(h => h.reason === HISTORY_REASONS.SPAWN);
}

export function getCoordsForFragment(fragment) {
    const spawnHistoryItem = getSpawnHistoryItemForFragment(fragment);
    return {
        latitude: spawnHistoryItem.destinationPortalInfo.latE6 / 1e6,
        longitude: spawnHistoryItem.destinationPortalInfo.lngE6 / 1e6,
    };
}

export function getFragmentSpawnTimeMs(fragment) {
    const spawnHistoryItem = getSpawnHistoryItemForFragment(fragment);
    return spawnHistoryItem ? Number(spawnHistoryItem.moveTimeMs) : null;
}

export function calculateCentroid(portalsMap) {
    const portalIds = Object.keys(portalsMap || {});
    if (portalIds.length === 0) return null;

    let totalLatitude = 0;
    let totalLongitude = 0;

    for (const id of portalIds) {
        const portal = portalsMap[id];
        totalLatitude += portal.lat;
        totalLongitude += portal.lng;
    }

    return {
        lat: truncateToDecimalPlaces(totalLatitude / portalIds.length, 6),
        lng: truncateToDecimalPlaces(totalLongitude / portalIds.length, 6),
    };
}

/**
 * Generates a consistent E6 string key for a portal lookup.
 * Handles both portal objects with lat/lng and those with latE6/lngE6.
 */
export function getPortalKey(portal) {
    if (!portal) return null;

    let latE6, lngE6;

    if (portal.latE6 !== undefined && portal.lngE6 !== undefined) {
        latE6 = portal.latE6;
        lngE6 = portal.lngE6;
    } else {
        latE6 = Math.round(portal.lat * 1e6);
        lngE6 = Math.round(portal.lng * 1e6);
    }

    return `${latE6}_${lngE6}`;
}

export function printTable(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const widths = {};
    for (const key of keys) {
        widths[key] = key.length;
    }
    for (const row of data) {
        for (const key of keys) {
            const valStr = String(row[key] !== undefined ? row[key] : '');
            widths[key] = Math.max(widths[key], valStr.length);
        }
    }

    const border = '├─' + keys.map(key => '─'.repeat(widths[key])).join('─┼─') + '─┤';
    const topBorder = '┌─' + keys.map(key => '─'.repeat(widths[key])).join('─┬─') + '─┐';
    const bottomBorder = '└─' + keys.map(key => '─'.repeat(widths[key])).join('─┴─') + '─┘';

    console.log(topBorder);
    console.log('│ ' + keys.map(key => key.padEnd(widths[key])).join(' │ ') + ' │');
    console.log(border);
    for (const row of data) {
        const rowStr = '│ ' + keys.map(key => {
            const val = row[key];
            const valStr = String(val !== undefined ? val : '');
            return typeof val === 'number' ? valStr.padStart(widths[key]) : valStr.padEnd(widths[key]);
        }).join(' │ ') + ' │';
        console.log(rowStr);
    }
    console.log(bottomBorder);
}

export function calculateShardActionSchedule(shardMechanic, siteGeocode) {
    const startTimeZoned = ZonedDateTime.fromString(siteGeocode.date);
    let schedule = {
        startTime: startTimeZoned,
        waves: []
    };

    for (const wave of shardMechanic.waves) {
        const waveStartTimeZoned = ZonedDateTime.add(
            startTimeZoned,
            Duration.fromFields({ minutes: wave.startOffset }),
        );

        let waveSchedule = [];
        for (const waveAction of shardMechanic.waveActions.filter((a) =>
            ["spawn", "jump", "despawn"].includes(a.action),
        )) {
            const waveActionTimeZoned = ZonedDateTime.add(
                waveStartTimeZoned,
                Duration.fromFields({ minutes: waveAction.time }),
            );
            waveSchedule.push({
                action: waveAction.action,
                time: waveActionTimeZoned
            });
        }
        schedule.waves.push(waveSchedule);
    }
    return schedule;
}

export function convertToCsv(data) {
    if (!data || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const lines = [headers.join(',')];
    for (const row of data) {
        const line = headers.map(header => {
            const val = row[header] !== undefined && row[header] !== null ? String(row[header]) : '';
            const shouldQuote = header.includes('Origin') || 
                                header.includes('Destination') || 
                                header.includes('Portal') || 
                                val.includes(',') || 
                                val.includes('"') || 
                                val.includes('\n');
            if (shouldQuote) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        lines.push(line.join(','));
    }
    return lines.join('\n');
}

export function formatZonedDateTimeWithMs(zdt) {
    if (!zdt) return '-';
    return ZonedDateTime.toLocaleString(zdt, 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hourCycle: 'h23'
    });
}

export function formatTimeWithMs(epochMs, timezone) {
    if (!epochMs) return '-';
    const inst = Instant.fromEpochMilliseconds(Number(epochMs));
    const zdt = Instant.toZonedDateTimeISO(inst, timezone);
    return formatZonedDateTimeWithMs(zdt);
}

export function formatDurationMs(durationMs, showDecimals = true) {
    const seconds = durationMs / 1000;
    const absSeconds = Math.abs(seconds);
    const minutes = Math.floor(absSeconds / 60);
    const remainingSeconds = absSeconds % 60;
    const formattedSeconds = showDecimals ? remainingSeconds.toFixed(1) : Math.round(remainingSeconds).toString();
    const sign = seconds < 0 ? "-" : "";
    return minutes > 0 ? `${sign}${minutes}m ${formattedSeconds}s` : `${sign}${formattedSeconds}s`;
}

