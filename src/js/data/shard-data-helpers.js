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

export function calculateCentroid(fragments) {
    let totalLatitude = 0;
    let totalLongitude = 0;

    for (const fragment of fragments) {
        const coords = getCoordsForFragment(fragment);
        totalLatitude += coords.latitude;
        totalLongitude += coords.longitude;
    }

    const centroid = {
        lat: truncateToDecimalPlaces(totalLatitude / fragments.length, 6),
        lng: truncateToDecimalPlaces(totalLongitude / fragments.length, 6),
    };
    return centroid;
}

