import * as L from "leaflet";
import { EVENT_BRANDS } from "../constants.js";
import { addEventInteraction } from "./event-handler.js";
import { navigate } from "../router.js";
import { getScoresText } from "./site-renderer.js";
import { getSeriesMetadata, getSeriesGeocode, getSiteData, getAllSeriesIds } from "../data/data-store.js";
import { formatIsoToShortDate, getTimeRemaining, getActiveEventRemaining } from "../shared/date-helpers.js";
import { getFlagTooltipHtml } from "./ui-formatters.js";
import { DateTime } from "luxon";
import eventBlueprints from "../../../conf/event_blueprints.json" with { type: "json" };
import { TACTICAL_MARKER_SVG } from "./marker-template.js";

const seriesLayerCache = new Map();

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'images/markers/marker-icon-2x.png',
    iconUrl: 'images/markers/marker-icon.png',
    shadowUrl: 'images/markers/marker-shadow.png',
});

function getOutcome(siteData) {
    const scores = siteData?.fullEvent?.scores;
    if (!scores) return 'NONE';
    if (scores.RES > scores.ENL) return 'RES';
    if (scores.ENL > scores.RES) return 'ENL';
    if (scores.RES > 0 || scores.ENL > 0) return 'TIE';
    return 'NONE';
}

function getEventDuration(site, seriesId) {
    const metadata = getSeriesMetadata(seriesId);
    if (!metadata?.shardComponents) return 240;

    const component = metadata.shardComponents.find(c => c.brand === site.brand);
    if (!component) return 240;

    const mechanicsId = component.shardMechanics || component.targetMechanics;
    const mechanics = eventBlueprints.mechanics.shards[mechanicsId] || eventBlueprints.mechanics.targets[mechanicsId];

    if (!mechanics) return 240;

    const lastWaveStart = mechanics.waves ? Math.max(...mechanics.waves.map(w => w.startOffset || 0)) : 0;

    // Based on requirement: Active time = last jump within a shards blueprint + 1 hour
    const jumpActions = mechanics.waveActions?.filter(a => a.action === 'jump') || [];
    if (jumpActions.length > 0) {
        const lastJumpOffset = Math.max(...jumpActions.map(a => a.time));
        return lastWaveStart + lastJumpOffset + 1; // +1 minute
    }

    const despawnAction = mechanics.waveActions?.find(a => a.action === 'despawn');
    if (despawnAction) {
        return lastWaveStart + despawnAction.time;
    }

    if (mechanics.waves) {
        return Math.max(...mechanics.waves.map(w => w.endOffset || 0));
    }

    return 240;
}

function isEventActive(site, seriesId) {
    const durationMins = getEventDuration(site, seriesId);

    const isoDate = site.date.split("[")[0];
    const startTime = DateTime.fromISO(isoDate, { zone: site.timezone });
    const endTime = startTime.plus({ minutes: durationMins });
    const now = DateTime.now().setZone(site.timezone);

    return now >= startTime && now <= endTime;
}

function renderSeriesLayer(seriesId) {
    const seriesLayer = L.featureGroup();
    seriesLayer._layerType = 'series';
    seriesLayer._seriesId = seriesId;

    const geocode = getSeriesGeocode(seriesId);
    if (!geocode?.sites) {
        return seriesLayer;
    }

    for (const site of Object.values(geocode.sites)) {
        const siteData = getSiteData(seriesId, site.id);
        const hasFragments = siteData?.fullEvent?.shards?.length > 0;
        const hasOrnaments = Object.values(siteData?.portals || {}).some(p => p.ornamentId);

        const isoDate = site.date.split("[")[0];
        const startTime = DateTime.fromISO(isoDate, { zone: site.timezone });
        const now = DateTime.now().setZone(site.timezone);

        let phaseClass = '';
        let outcome = 'NONE';

        if (hasFragments) {
            // Outcome phase: Shard jump data is available
            outcome = getOutcome(siteData);
            phaseClass = `is-phase-outcome outcome-${outcome.toLowerCase()}`;
        } else if (isEventActive(site, seriesId)) {
            // Active phase: Event is happening now
            phaseClass = 'is-phase-active';
        } else if (now < startTime) {
            // Future sites
            if (hasOrnaments) {
                // Discovery phase: Future and information available
                phaseClass = 'is-phase-discovery';
            } else {
                // No data: Future and no information
                phaseClass = 'is-phase-nodata';
            }
        } else {
            // Past sites with no outcome data yet
            phaseClass = 'is-phase-nodata';
        }

        const markerOptions = {
            icon: L.divIcon({
                className: `marker-radar-container ${phaseClass}`,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                tooltipAnchor: [13, -28],
                html: `
                    ${phaseClass.includes('phase-active') || phaseClass.includes('phase-discovery') ? '<div class="marker-radar-beam"></div>' : ''}
                    ${TACTICAL_MARKER_SVG}
                `
            })
        };

        const latLng = L.latLng(site.lat, site.lng);
        const siteMarker = L.marker(latLng, markerOptions);
        siteMarker._siteId = site.id;

        const flagHtml = site.country_code ? getFlagTooltipHtml(site.country_code.toLowerCase()) : '';
        const remainingTime = getTimeRemaining(site.date, site.timezone);
        const timeRemainingText = remainingTime ? ` (${remainingTime})` : '';

        const eventDuration = getEventDuration(site, seriesId);
        const endTime = startTime.plus({ minutes: eventDuration });
        const completionGraceEnd = endTime.plus({ days: 1 });
        const isComplete = now > endTime;
        const isWithinCompletionGrace = now <= completionGraceEnd;
        const activeRemaining = getActiveEventRemaining(site.date, site.timezone, eventDuration);

        let siteTooltip = '';
        if (activeRemaining) {
            siteTooltip += `<strong>Site Active</strong> - ${activeRemaining} remaining<hr />`;
        } else if (isComplete && isWithinCompletionGrace && !hasFragments) {
            siteTooltip += `<strong>Site Complete</strong> - <em>compiling XM telemetry.</em><hr />`;
        }

        siteTooltip += `
            ${flagHtml} <strong>${site.name}</strong><br />
            Date: ${formatIsoToShortDate(site.date, site.timezone)}${timeRemainingText}<br />
            Type: ${EVENT_BRANDS[site.brand].name}<br />`;

        if (siteData) {
            const scoresText = getScoresText({ seriesId, siteId: site.id, type: 'full' });
            if (scoresText) {
                siteTooltip += scoresText;
            } else if (hasOrnaments) {
                const count = Object.values(siteData.portals || {}).filter(portal => portal.ornamentId).length;
                siteTooltip += `<em>${count} ornamented portal${count === 1 ? '' : 's'}</em>`;
            }
            const siteUrl = `#/${seriesId}/${site.id.replace(seriesId + "-", "")}`;
            addEventInteraction(siteMarker, 'click', () => { navigate(siteUrl); });
        } else if (startTime.toJSDate().getTime() < now.toJSDate().getTime()) {
            siteTooltip += `<em>No data available</em>`;
        }
        siteMarker.bindTooltip(siteTooltip, { permanent: false, direction: 'auto' });
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
    const sitesByBrand = sites.reduce((groups, site) => {
        const brand = site.brand || 'Other';
        if (!groups[brand]) groups[brand] = [];
        groups[brand].push(site);
        return groups;
    }, {});

    const typeOrder = Object.keys(EVENT_BRANDS);

    let content = '';
    if (metadata.year) {
        content += `Year: ${metadata.year}<br />`;
    }
    if (metadata.overviewUrl) {
        content += `<a href="${metadata.overviewUrl}" target="_blank">Series Overview</a><br /><br />`;
    }

    content += `<div class="series-sites-list">`;

    typeOrder.forEach(brand => {
        if (sitesByBrand[brand]) {
            const sitesOfBrand = sitesByBrand[brand];

            content += `<h4 class="group-header group-toggle">
                    <span class="toggle-icon">▶</span>
                    ${sitesOfBrand.length} ${EVENT_BRANDS[brand].name} Sites</h4>`;
            content += `<div class="group-list collapsed-group">`;

            sitesOfBrand.forEach(site => {
                const flag = site.country_code ? getFlagTooltipHtml(site.country_code.toLowerCase()) : '';
                const siteUrl = `#/${metadata.id}/${site.id.replace(metadata.id + "-", "")}`;

                const scoresText = getScoresText({
                    seriesId: metadata.id,
                    siteId: site.id,
                    type: 'simple',
                    timezone: site.timezone
                });
                content += `
                        <button 
                                class="nav-item"
                                data-route="${siteUrl}"
                                data-site-id="${site.id}"
                                id="${site.id}"
                                ${!scoresText ? 'disabled="disabled"' : ''}>
                            ${flag} ${site.name}
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