import * as L from "leaflet";
import { SHARD_EVENT_TYPE } from "../constants.js";
import { addEventInteraction } from "./event-handler.js";
import { navigate } from "../router.js";
import { getScoresText } from "./site-renderer.js";
import { getSeriesMetadata, getSeriesGeocode, getSiteData, getAllSeriesIds } from "../data/data-store.js";
import { formatIsoToShortDate } from "../shared/date-helpers.js";
import { getFlagTooltipHtml } from "./ui-formatters.js"

const seriesLayerCache = new Map();

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'images/markers/marker-icon-2x.png',
    iconUrl: 'images/markers/marker-icon.png',
    shadowUrl: 'images/markers/marker-shadow.png',
});

const SiteIcon = L.Icon.Default.extend({
    options: {
        filter: ''
    },

    createIcon: function (oldIcon) {
        const icon = L.Icon.Default.prototype.createIcon.call(this, oldIcon);
        if (this.options.filter) {
            icon.style.filter = this.options.filter;
        }
        return icon;
    }
});

function renderSeriesLayer(seriesId) {
    const seriesLayer = L.featureGroup();
    seriesLayer._layerType = 'series';
    seriesLayer._seriesId = seriesId;

    const geocode = getSeriesGeocode(seriesId);
    if (!geocode?.sites) {
        return seriesLayer;
    }

    const nowDate = new Date();
    for (const site of Object.values(geocode.sites)) {
        const siteData = getSiteData(seriesId, site.id);

        let siteMarkerFilter = 'grayscale(1)';
        if (siteData) {
            siteMarkerFilter = SHARD_EVENT_TYPE[site.type].markerFilter;
        }
        const siteIcon = new SiteIcon({ filter: siteMarkerFilter });

        const latLng = L.latLng(site.lat, site.lng);
        const siteMarker = L.marker(latLng, { icon: siteIcon });
        siteMarker._siteId = site.id;

        const flagHtml = site.country_code ? getFlagTooltipHtml(site.country_code.toLowerCase()) : '';
        let siteTooltip = `
            ${flagHtml} <strong>${site.location}</strong><br />
            Date: ${formatIsoToShortDate(site.date, site.timezone)}<br />
            Type: ${SHARD_EVENT_TYPE[site.type].name}<br />`;

        if (siteData) {
            const scoresText = getScoresText({ seriesId, siteId: site.id, type: 'full' });
            if (scoresText) {
                siteTooltip += scoresText;
            }
            const siteUrl = `#/${seriesId}/${site.id.replace(seriesId + "-", "")}`;
            addEventInteraction(siteMarker, 'click', () => { navigate(siteUrl); });
        } else if (new Date(site.date).getTime() < nowDate.getTime()) {
            siteTooltip += `<em>No data available</em>`;
        }
        siteMarker.bindTooltip(siteTooltip, { permanent: false });
        siteMarker.addTo(seriesLayer);
    }
    return seriesLayer;
}

export function initSeriesLayers() {
    const allSeriesIds = getAllSeriesIds();
    for (const seriesId of allSeriesIds) {
        if (!seriesLayerCache.has(seriesId)) {
            seriesLayerCache.set(seriesId, renderSeriesLayer(seriesId));
        }
    }
}

export function updateCustomSeriesLayer(seriesId) {
    const currentSeriesLayer = seriesLayerCache.get(seriesId);
    if (!currentSeriesLayer) return;
    const currentSiteMarkers = [];
    currentSeriesLayer.eachLayer(function (layer) {
        if (layer instanceof L.Marker) {
            currentSiteMarkers.push(layer);
        }
    });

    const updatedSeriesLayer = renderSeriesLayer(seriesId);
    updatedSeriesLayer.eachLayer(function (layer) {
        if (
            layer instanceof L.Marker &&
            layer._siteId &&
            !currentSiteMarkers.find(marker => marker._siteId === layer._siteId)) {
            currentSeriesLayer.addLayer(layer);
        }
    });
}

export function getSeriesLayer(seriesId) {
    return seriesLayerCache.get(seriesId);
}

export function getSeriesControl() {
    let controlLayers = {};
    for (const [seriesId, layer] of seriesLayerCache.entries()) {
        const metadata = getSeriesMetadata(seriesId);
        const seriesLabel = metadata.year ? `${metadata.year}: ${metadata.name}` : metadata.name;
        controlLayers[seriesLabel] = layer;
    }
    return L.control.layers(controlLayers, {}, { collapsed: true, position: "topleft" });
}

export function getDetailsPanelContent(seriesId) {
    const metadata = getSeriesMetadata(seriesId);
    const geocode = getSeriesGeocode(seriesId);

    if (!metadata || !geocode || !geocode.sites) {
        return { title: metadata?.name || 'Details', content: '<p><em>Series information not available.</em></p>' };
    }

    const sites = Object.values(geocode.sites);
    const sitesByType = sites.reduce((groups, site) => {
        const type = site.type || 'Other';
        if (!groups[type]) groups[type] = [];
        groups[type].push(site);
        return groups;
    }, {});

    const typeOrder = Object.entries(SHARD_EVENT_TYPE)
        .sort(([, a], [, b]) => a.typeOrder - b.typeOrder)
        .map(([key]) => key);

    let content = '';
    if (metadata.year) {
        content += `Year: ${metadata.year}<br />`;
    }
    if (metadata.overviewUrl) {
        content += `<a href="${metadata.overviewUrl}" target="_blank">Series Overview</a><br /><br />`;
    }

    content += `<div class="series-sites-list">`;

    typeOrder.forEach(type => {
        if (sitesByType[type]) {
            const sitesOfType = sitesByType[type];

            content += `<h4 class="group-header group-toggle">
                    <span class="toggle-icon">▶</span>
                    ${sitesOfType.length} ${SHARD_EVENT_TYPE[type].name} Sites</h4>`;
            content += `<div class="group-list collapsed-group">`;

            sitesOfType.forEach(site => {
                const flag = site.country_code ? getFlagTooltipHtml(site.country_code.toLowerCase()) : '';
                const siteUrl = `#/${metadata.id}/${site.id.replace(metadata.id + "-", "")}`;

                const scoresText = getScoresText({ seriesId: metadata.id, siteId: site.id, type: 'simple' });
                content += `
                        <button 
                                class="nav-item"
                                data-route="${siteUrl}"
                                data-site-id="${site.id}"
                                id="${site.id}"
                                ${!scoresText ? 'disabled="disabled"' : ''}>
                            ${flag} ${site.location}
                        </button>
                        ${scoresText && ` ${scoresText}`}<br />`;
            });
        }
        content += `</div> `;
    });

    return {
        title: `${metadata.name} Series Details`,
        content,
        footer: sites.length > 0 ? 'Select a specific site for details.' : 'No Sites found.',
    };
}

function getMarkerBySiteId(seriesLayer, siteId) {
    if (!seriesLayer) return null;

    let foundLayer = null;
    seriesLayer.eachLayer(function (layer) {
        if (!foundLayer && layer instanceof L.Marker && layer._siteId === siteId) {
            foundLayer = layer;
        }
    });
    return foundLayer;
}

export function setupMarkerHover(seriesLayer) {
    const buttons = document.querySelectorAll('.details-panel-content .nav-item');

    buttons.forEach(button => {
        const siteId = button.dataset.siteId;

        const targetMarker = getMarkerBySiteId(seriesLayer, siteId);
        if (targetMarker) {
            button.addEventListener('mouseover', () => { targetMarker.openTooltip(); });
            button.addEventListener('mouseout', () => { targetMarker.closeTooltip(); });
        }
    });
}