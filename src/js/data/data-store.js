import seriesMetadata from "../../../conf/series_metadata.json" with { type: "json" };
import seriesGeocode from "../../../conf/series_geocode.json" with { type: "json" };
import seriesData from "../../../data/processed/processed_series_data.json" with { type: "json" };
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
            sites: [],
        },
        data: {},
    };

    for (const sm of seriesMetadata) {
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
                sites: sitesMap
            };
        }
    }

    for (const [seriesId, data] of Object.entries(seriesData)) {
        seriesCache[seriesId].data = data;
    }

    if (!defaultSeriesId && seriesMetadata.length > 0) {
        defaultSeriesId = seriesMetadata[0].id;
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