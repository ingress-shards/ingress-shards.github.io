import { CUSTOM_SEASON_ID, SITE_AGGREGATION_DISTANCE } from '../constants.js';
import { haversineDistance, roundToDecimalPlaces } from "../shared/math-helpers.js";
import { formatEpochToSerializationString, isWithin24Hours } from '../shared/date-helpers.js';
import { getEventConfigRegistry } from '../../config/EventConfig.js';
import { DataIngestionPipeline } from "@ingress-shards/ingress-events-core";

const siteCounter = Symbol("siteCounter");
const rawFragments = Symbol("rawFragments");

self.onmessage = async function (event) {
    const { seriesId, customFile } = event.data;

    try {
        console.log(`Processing custom file: ${customFile.fileName}`);
        const parsedData = JSON.parse(customFile.rawData);
        const customGeocode = getCustomGeocode({ fileName: customFile.fileName, parsedData });

        const registry = getEventConfigRegistry();
        for (const site of customGeocode.sites) {
            const startMs = new Date(site.date).getTime();
            registry.registerSite({
                seasonId: CUSTOM_SEASON_ID,
                geocode: {
                    id: site.id,
                    name: site.name,
                    latE6: Math.round(site.lat * 1e6),
                    lngE6: Math.round(site.lng * 1e6),
                    eventType: site.eventType,
                    startTime: site.date,
                    timeZone: "UTC",
                },
                timeline: {
                    start: startMs,
                    preEventCutoff: startMs - 7200000,
                    end: startMs + 14400000,
                    durationMinutes: 240,
                    shards: [{
                        waveNumber: 1,
                        start: startMs,
                        end: startMs + 14400000,
                        expectedShards: site[rawFragments].length,
                        shardsActions: [],
                    }],
                },
            });
        }

        const candidateSites = registry.getSitesForSeason(CUSTOM_SEASON_ID);
        const pipeline = new DataIngestionPipeline(registry, candidateSites);
        const siteStates = await pipeline.ingestBatch([{
            filename: customFile.fileName,
            data: customFile.rawData,
        }]);
        const states = Object.fromEntries(siteStates.map((s) => [s.metadata.siteId, s]));

        const customProcessedData = {
            geocode: customGeocode,
            data: states,
        };
        self.postMessage({ status: "complete", processedData: customProcessedData, seriesId });
    } catch (error) {
        console.error('Error during processing:', error);
        self.postMessage({ status: "error", message: error.message });
    }
};

function getCustomGeocode({ fileName, parsedData }) {
    const customGeocode = {
        sites: [],

        [siteCounter]: 1,
    };

    const artifacts = parsedData.artifact.filter((d) => d.fragment);
    artifacts.sort((a, b) => a.name.localeCompare(b.name));

    for (const artifact of artifacts) {
        const sortedFragments = artifact.fragment.sort((a, b) => a.id.localeCompare(b.id));
        for (const fragment of sortedFragments) {
            const fragmentCoords = getCoordsForFragment(fragment);
            const matchedSite = customGeocode.sites.find(site => {
                const siteCoords = {
                    latitude: site.lat,
                    longitude: site.lng,
                };

                const distance = roundToDecimalPlaces(haversineDistance(fragmentCoords, siteCoords), 2);
                const siteDate = new Date(site.date).getTime();
                const matchingDate = isWithin24Hours(getFragmentSpawnTimeMs(fragment), siteDate);

                return (distance < SITE_AGGREGATION_DISTANCE && matchingDate);
            });

            if (matchedSite) {
                matchedSite[rawFragments].push(fragment);
            } else {
                const siteId = `${CUSTOM_SEASON_ID}-${fileName}-${customGeocode[siteCounter]}`;
                const fragmentSpawnTimeMs = getFragmentSpawnTimeMs(fragment);
                const newSite = {
                    id: siteId,
                    lat: fragmentCoords.latitude,
                    lng: fragmentCoords.longitude,
                    eventType: 'UNKNOWN',
                    date: formatEpochToSerializationString(fragmentSpawnTimeMs),
                    name: `${fileName}-${customGeocode[siteCounter]}`,

                    [rawFragments]: []
                };
                customGeocode.sites.push(newSite);
                customGeocode[siteCounter]++;
                newSite[rawFragments].push(fragment);
            }
        }
    }
    for (const site of customGeocode.sites) {
        site.eventType = site[rawFragments].length > 1 ? 'MULTIPLE_SHARDS' : 'SINGLE_SHARD';
        const centroid = calculateCentroid(site[rawFragments]);
        site.lat = centroid.lat;
        site.lng = centroid.lng;
    }

    return customGeocode;
}

/**
 * @deprecated Legacy conversion logic pending Phase 5 migration to Core's DataObservationAdapter and custom upload pipeline.
 */
function getCoordsForFragment(fragment) {
    const spawnHistoryItem = fragment.history?.find(h => h.reason === "spawn" || h.action === "spawn") ?? fragment.history?.[0];
    const portal = spawnHistoryItem?.destinationPortalInfo || spawnHistoryItem?.originPortalInfo;
    return {
        latitude: portal ? portal.latE6 / 1e6 : 0,
        longitude: portal ? portal.lngE6 / 1e6 : 0,
    };
}

/**
 * @deprecated Legacy conversion logic pending Phase 5 migration to Core's DataObservationAdapter and custom upload pipeline.
 */
function getFragmentSpawnTimeMs(fragment) {
    const spawnHistoryItem = fragment.history?.find(h => h.reason === "spawn" || h.action === "spawn") ?? fragment.history?.[0];
    return spawnHistoryItem ? Number(spawnHistoryItem.moveTimeMs ?? spawnHistoryItem.moveTime) : Date.now();
}

/**
 * @deprecated Legacy conversion logic pending Phase 5 migration to Core's DataObservationAdapter and custom upload pipeline.
 */
function calculateCentroid(fragments) {
    let totalLat = 0, totalLng = 0, count = 0;
    for (const f of fragments) {
        const coords = getCoordsForFragment(f);
        if (coords.latitude && coords.longitude) {
            totalLat += coords.latitude;
            totalLng += coords.longitude;
            count++;
        }
    }
    return {
        lat: count > 0 ? roundToDecimalPlaces(totalLat / count, 6) : 0,
        lng: count > 0 ? roundToDecimalPlaces(totalLng / count, 6) : 0,
    };
}

