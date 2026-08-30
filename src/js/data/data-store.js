import seriesMetadata from "../../../conf/series_metadata.json" with { type: "json" };
import seriesGeocode from "../../../gen/series_geocode.json" with { type: "json" };
import { CUSTOM_SERIES_ID } from "../constants.js";

const seriesCache = {};
let defaultSeriesId = null;

export async function initDataStore() {
    seriesCache.custom = {
        metadata: {
            id: CUSTOM_SERIES_ID,
            name: "Custom",
        },
        geocode: {
            id: CUSTOM_SERIES_ID,
            sites: {},
        },
        data: {},
    };

    for (const sm of seriesMetadata.series) {
        seriesCache[sm.id] = {
            metadata: sm,
            geocode: null,
            data: null,
        };
        if (sm.defaultView) {
            defaultSeriesId = sm.id;
        }
    }

    for (const [seriesId, geo] of Object.entries(seriesGeocode)) {
        if (seriesCache[seriesId]) {
            const sitesMap = geo.sites.reduce((acc, site) => {
                acc[site.id] = site;
                return acc;
            }, {});

            seriesCache[seriesId].geocode = {
                sites: sitesMap,
            };
        }
    }

    if (!defaultSeriesId && seriesMetadata.series.length > 0) {
        defaultSeriesId = seriesMetadata.series[0].id;
    }
}

export async function loadSeriesData(seriesId) {
    if (!seriesId) return null;
    if (seriesId === CUSTOM_SERIES_ID) {
        return seriesCache.custom?.data || {};
    }

    const entry = seriesCache[seriesId];
    if (!entry) return null;
    if (entry.data) return entry.data;

    try {
        const response = await fetch(`data/${seriesId}.json`);
        if (!response.ok) {
            console.warn(`Could not load series data for ${seriesId}: HTTP ${response.status}`);
            return null;
        }
        const data = await response.json();
        entry.data = data;
        return data;
    } catch (error) {
        console.error(`Failed to fetch series data for ${seriesId}:`, error);
        return null;
    }
}

export function getAllSeriesIds() {
    return Object.keys(seriesCache);
}

export function getDefaultSeriesId() {
    return defaultSeriesId;
}

export function getSeriesMetadata(seriesId) {
    return seriesCache[seriesId]?.metadata;
}

export function getSeriesGeocode(seriesId) {
    return seriesCache[seriesId]?.geocode;
}

export function getSiteData(seriesId, siteId) {
    const seriesEntry = seriesCache[seriesId];
    return seriesEntry?.data?.[siteId];
}

export function addCustomData(processedData) {
    const { geocode, data } = processedData;

    for (const site of geocode.sites) {
        seriesCache[CUSTOM_SERIES_ID].geocode.sites[site.id] = site;
    }

    for (const [siteId, siteData] of Object.entries(data)) {
        seriesCache.custom.data[siteId] = siteData;
    }
}
