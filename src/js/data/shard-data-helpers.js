import { HISTORY_REASONS } from "../constants.js";
import { truncateToDecimalPlaces } from "../shared/math-helpers.js";

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

