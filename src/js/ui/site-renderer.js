import * as L from "leaflet";
import { HISTORY_REASONS, FACTION_COLORS, INGRESS_INTEL_PORTAL_LINK, EVENT_BRANDS, ORNAMENT_BRANDS, SIGNAL_COLOR, ORNAMENT_ONLY_COLOR } from "../constants.js";
import shardIconUrl from '../../images/abaddon1_shard.png';
import { getSiteData, getSeriesMetadata, getSeriesGeocode } from "../data/data-store.js";
import { getFlagTooltipHtml } from "./ui-formatters.js"
import { formatEpochToLocalTime, formatIsoToShortDate, getTimeRemaining, getActiveEventRemaining } from "../shared/date-helpers.js";
import { getHexagonSVG } from "./marker-template.js";

const shardIcon = L.icon({
    iconUrl: shardIconUrl,
    iconSize: [24, 24], // Source image is 48x48 with a 32x32 active area (8px padding). 24px icon size results in a 16px visual shard.
    iconAnchor: [12, 12],
});

const siteLayerCache = new Map();
let activeSiteLayer = null;

export function getSiteLayers(seriesId, siteId) {
    let cacheEntry = siteLayerCache.get(siteId);
    if (!cacheEntry) {
        const siteData = getSiteData(seriesId, siteId);
        if (!siteData) return null;

        cacheEntry = renderSiteData({ seriesId, siteId, siteData });
        siteLayerCache.set(siteId, cacheEntry);
    }
    return cacheEntry;
}

export function setActiveSiteLayer(siteLayer) {
    activeSiteLayer = siteLayer;
}

function renderSiteData({ seriesId, siteId, siteData }) {
    const layersDetails = [];
    const hasShards = siteData.fullEvent?.shards?.length > 0;

    const ornamentLayer = L.featureGroup();
    ornamentLayer._layerType = 'site-overlay';
    ornamentLayer._siteId = siteId;
    let ornamentCount = 0;
    for (const portal of Object.values(siteData.portals || {})) {
        if (portal.ornamentId) {
            ornamentCount++;
            const latLng = L.latLng(portal.lat, portal.lng);
            const brand = ORNAMENT_BRANDS[portal.ornamentId];
            const style = brand?.style || {};
            const ornamentColor = style.color || SIGNAL_COLOR;

            let markerIcon;
            let pane = 'ornamentPane';

            if (style.icon) {
                // 1a. The Visual Image Ornament
                markerIcon = L.icon({
                    iconUrl: style.icon,
                    iconSize: style.size || [40, 40],
                    iconAnchor: style.size ? [style.size[0] / 2, style.size[1] / 2] : [20, 20]
                });
                pane = 'ornamentFrontPane';
            } else {
                // 1b. The Visual Hexagon Frame (using custom color)
                markerIcon = L.divIcon({
                    className: 'ornament-hexagon-marker',
                    html: getHexagonSVG(ornamentColor),
                    iconSize: [40, 40],
                    iconAnchor: [20, 20]
                });
            }

            L.marker(latLng, {
                icon: markerIcon,
                interactive: false,
                pane: pane
            }).addTo(ornamentLayer);

            // 2. The Interactive Anchor Pin (Opt-in)
            const tooltipHtml = formatPortalTooltip(portal, [], siteData.geocode.timezone);
            L.circleMarker(latLng, {
                radius: 6,
                color: ORNAMENT_ONLY_COLOR,
                fillOpacity: 0.4,
                weight: 1,
                interactive: true,
                pane: 'ornamentPane'
            }).bindTooltip(tooltipHtml, { interactive: true })
                .bindPopup(tooltipHtml, { closeButton: false, autoClose: true })
                .addTo(ornamentLayer);
        }
    }

    if (ornamentLayer.getLayers().length > 0) {
        layersDetails.push({
            id: "ornaments",
            label: "Ornaments",
            layer: ornamentLayer,
            isOverlay: true,
            showByDefault: !hasShards || ornamentCount < 10
        });
    }

    const isSingularEvent = !siteData.waves || siteData.waves.length <= 1;

    if (hasShards) {
        const fullEventLayer = renderShardLayer({
            seriesId,
            siteId,
            shardData: siteData.fullEvent,
            portals: siteData.portals,
            timezone: siteData.geocode.timezone,
            layerType: 'site',
        });
        fullEventLayer._seriesId = seriesId;
        layersDetails.push({
            id: "all",
            label: isSingularEvent ? "Shards" : "All waves",
            layer: fullEventLayer,
            hideFromControl: isSingularEvent
        });

        if (!isSingularEvent) {
            siteData.waves.forEach((wave, index) => {
                const waveNumber = index + 1;
                const waveId = `wave-${waveNumber}`;
                const waveLayer = renderShardLayer({
                    seriesId,
                    siteId,
                    shardData: wave,
                    portals: siteData.portals,
                    timezone: siteData.geocode.timezone,
                    layerType: 'wave',
                });
                waveLayer._seriesId = seriesId;
                waveLayer._waveId = waveId;
                layersDetails.push({
                    id: waveId,
                    label: `Wave ${waveNumber}`,
                    layer: waveLayer,
                });
            });
        }
    }
    return layersDetails;
}

export function getSiteControl(siteId) {
    let controlLayers = {};
    let overlays = {};
    const cacheEntry = siteLayerCache.get(siteId);
    if (!cacheEntry) return null;

    for (const layerDetails of cacheEntry) {
        if (layerDetails.hideFromControl) continue;
        if (layerDetails.isOverlay) {
            overlays[layerDetails.label] = layerDetails.layer;
        } else {
            controlLayers[layerDetails.label] = layerDetails.layer;
        }
    }
    if (Object.keys(controlLayers).length === 0 && Object.keys(overlays).length === 0) {
        return null;
    }
    return L.control.layers(controlLayers, overlays, { collapsed: true, position: "bottomright" });
}

function renderShardLayer({ seriesId, siteId, shardData, portals, timezone, layerType }) {
    const shardLayer = L.featureGroup();
    shardLayer._layerType = layerType;
    shardLayer._siteId = siteId.replace(seriesId + "-", "");

    const safeShardData = shardData || {};
    const shardPathsMap = createShardPathLayers(safeShardData.shardPaths || {}, portals, timezone);
    shardPathsMap.forEach((shardPath) => shardPath.addTo(shardLayer));

    const { portalHistoryMap, shardMotionData } = processShardData(safeShardData.shards || [], portals);
    const shardMotionPaths = createShardMotionPaths(shardMotionData);

    shardLayer.shardMotionPaths = [];
    shardMotionPaths.forEach((shardPathPoly) => {
        shardPathPoly.addTo(shardLayer);
        shardLayer.shardMotionPaths.push(shardPathPoly);

        for (const shardPath of shardPathPoly.shardPaths) {
            const path = shardPathsMap.get(shardPath);
            if (path) path.shardPathPoly = shardPathPoly;
            path.on("mouseover", function () {
                shardPathPoly.motionStart();
            });
        }
    });

    shardLayer.startShardMotion = function () {
        this.shardMotionPaths.forEach(shardPathPoly => {
            shardPathPoly.motionStart();
        });
    };

    const { portalMarkers, staticShardMarkers } = createPortalMarkers(portals, portalHistoryMap, timezone);
    portalMarkers.forEach((marker) => marker.addTo(shardLayer));
    staticShardMarkers.forEach((marker) => marker.addTo(shardLayer));

    return shardLayer;
}

function createShardPathLayers(shardPaths, portalsMap, timezone) {
    const shardPathsMap = new Map();
    if (!shardPaths) return shardPathsMap;

    for (const [shardPathKey, shardPath] of Object.entries(shardPaths)) {
        const shardPathPortals = shardPathKey.split("-").map(idString => {
            const id = Number(idString);
            return {
                id,
                ...(portalsMap[id]),
            }
        });

        const shardPathDetails = renderShardPath(shardPath, shardPathPortals, timezone);
        shardPathsMap.set(shardPathKey, shardPathDetails);
    }
    return shardPathsMap;
}

function processShardData(shards, portalsMap) {
    const portalHistoryMap = {};
    const shardMotionData = [];
    if (!shards) return { portalHistoryMap, shardMotionData };

    for (const shard of shards) {
        const coords = [];
        const shardPaths = [];

        for (const historyItem of shard.history) {
            const portalIds = historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP
                ? [historyItem.portalId, historyItem.dest]
                : [historyItem.portalId];

            if (historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP) {
                const originPortal = portalsMap[historyItem.portalId];
                const destPortal = portalsMap[historyItem.dest];

                shardPaths.push([historyItem.portalId, historyItem.dest].sort().join('-'));
                if (coords.length === 0) {
                    coords.push(L.latLng(originPortal.lat, originPortal.lng));
                }
                coords.push(L.latLng(destPortal.lat, destPortal.lng));
            }

            for (const portalId of portalIds) {
                if (!portalHistoryMap[portalId]) {
                    portalHistoryMap[portalId] = new Map();
                }
                const portalHistory = portalHistoryMap[portalId];
                if (!portalHistory.has(shard.id)) {
                    portalHistory.set(shard.id, []);
                }
                portalHistory.get(shard.id).push(historyItem);
            }
        }

        if (coords.length > 0 && shardPaths.length > 0) {
            shardMotionData.push({ coords, shardPaths });
        }
    }

    return {
        shardMotionData,
        portalHistoryMap,
    };
}

function createShardMotionPaths(shardMotionData) {
    return shardMotionData.map(({ coords, shardPaths }) => {
        const shardPathPoly = L.motion.polyline(
            coords,
            {
                color: "transparent",
                interactive: false,
            },
            { auto: false, duration: shardPaths.length * 1000 },
            {
                showMarker: true,
                removeOnEnd: false,
                icon: shardIcon,
                interactive: false,
                pane: 'shardPane'
            }
        );
        shardPathPoly.shardPaths = shardPaths;
        return shardPathPoly;
    });
}

function createPortalMarkers(portals, portalHistoryMap, timeZone) {
    const portalMarkers = [];
    const staticShardMarkers = [];

    for (const [portalId, portal] of Object.entries(portals)) {
        const latLng = L.latLng(portal.lat, portal.lng);

        const portalHistory = Array.from(portalHistoryMap[portalId] || []);
        if (portalHistory.length === 0) continue;

        const lastKnownTeam = getLastKnownTeam(portalHistory);
        const portalTooltip = formatPortalTooltip(portal, portalHistory, timeZone);

        portalHistory.forEach(([, shardHistory]) => {
            const shardHistoryReasons = shardHistory.flatMap(h => h.reason);
            const isStaticSpawn = shardHistoryReasons.includes(HISTORY_REASONS.SPAWN) &&
                !shardHistoryReasons.includes(HISTORY_REASONS.LINK) &&
                !shardHistoryReasons.includes(HISTORY_REASONS.JUMP);

            if (isStaticSpawn) {
                staticShardMarkers.push(L.marker(latLng, {
                    icon: shardIcon,
                    pane: 'shardPane'
                }).bindTooltip(portalTooltip).bindPopup(portalTooltip));
            }
        });

        portalMarkers.push(
            L.circleMarker(latLng, {
                color: FACTION_COLORS[lastKnownTeam] || FACTION_COLORS.NEU,
                pane: 'markerPane'
            }).bindTooltip(portalTooltip, {
                interactive: true
            }).bindPopup(portalTooltip, {
                closeButton: false,
                autoClose: true,
            })
        );
    }
    return {
        portalMarkers,
        staticShardMarkers,
    };
}

function formatPortalTooltip(portal, portalHistory, timeZone) {
    const ornamentLabel = ORNAMENT_BRANDS[portal.ornamentId]?.label || `Ornament: ${portal.ornamentId}`;
    const ornamentHtml = portal.ornamentId ? `<i>${ornamentLabel}</i><br/>` : '';
    const separator = portalHistory.length > 0 ? '<hr />' : '';
    let tooltipHtml = `<strong>${portal.title}</strong> <a href="${INGRESS_INTEL_PORTAL_LINK}${portal.lat},${portal.lng}" target="intel_page">Intel</a><br/>${ornamentHtml}${separator}`;

    portalHistory.forEach(([shardId, shardHistory], index) => {
        tooltipHtml += `<strong>Shard ${shardId}</strong><br />`;
        for (const historyItem of shardHistory) {
            const teamToDisplay = ![HISTORY_REASONS.NO_MOVE, HISTORY_REASONS.JUMP].includes(historyItem.reason) ? historyItem.team || "NEU" : undefined;

            let reasonToDisplay = historyItem.reason;
            if (historyItem.reason === HISTORY_REASONS.LINK) reasonToDisplay = HISTORY_REASONS.JUMP;
            else if (historyItem.reason === HISTORY_REASONS.JUMP) reasonToDisplay = 'randomly teleported';

            tooltipHtml += `${reasonToDisplay} at ${formatEpochToLocalTime(historyItem.moveTime, timeZone)}${teamToDisplay ? ` - <span style="color:${FACTION_COLORS[teamToDisplay]}">${teamToDisplay}</span>` : ""}<br />`;
        }

        if (index < portalHistory.length - 1) {
            tooltipHtml += `<hr class="tooltip-sub-divider" />`;
        }
    });

    return tooltipHtml;
}

function getLastKnownTeam(portalHistory) {
    if (!portalHistory) {
        return undefined;
    }

    const portalHistoryEntries = portalHistory
        .map(([, historyItems]) => historyItems)
        .flatMap((historyItem) => historyItem || [])
        .filter(
            (historyItem) =>
                historyItem.reason !== "despawn" && historyItem.team
        )
        .sort((a, b) => b.moveTime - a.moveTime);
    return portalHistoryEntries[0]?.team;
}

function renderShardPath(shardPath, shardPathPortals, timeZone) {
    let polyline;

    if (shardPath.links && shardPath.links.length > 0) {
        const { tooltip, coords, biDirectionalMoves } = formatLinkPathTooltip(shardPath, shardPathPortals, timeZone);
        const linkColor = FACTION_COLORS[shardPath.links[shardPath.links.length - 1].team] || FACTION_COLORS.NEU;

        polyline = L.polyline(coords, {
            color: linkColor,
            dashArray: ["10,5,5,5,5,5,5,5,10000"],
        });
        polyline.biDirectionalJumps = biDirectionalMoves;
        polyline.bindTooltip(tooltip, { sticky: true }).bindPopup(tooltip, { sticky: true });
    } else if (shardPath.jumps && shardPath.jumps.length > 0) {
        const { tooltip, coords } = formatJumpPathTooltip(shardPath, shardPathPortals, timeZone);

        polyline = L.polyline(coords, {
            color: SIGNAL_COLOR,
            dashArray: ["10,10"],
        });
        polyline.bindTooltip(tooltip, { sticky: true }).bindPopup(tooltip, { sticky: true });
    }

    return polyline;
}

function formatLinkPathTooltip(shardPath, shardPathPortals, timeZone) {
    const [portalA, portalB] = shardPathPortals;
    const moveOrigins = new Set(shardPath.links.flatMap(link => link.moves).map(move => move.origin));
    const biDirectionalMoves = moveOrigins.size > 1;
    const distanceDisplay = shardPath.distance < 1000 ? `${shardPath.distance}m` : `${(shardPath.distance / 1000).toFixed(2)}km`;

    let fromPortal, toPortal, coords, tooltip;

    if (biDirectionalMoves) {
        coords = [L.latLng(portalA.lat, portalA.lng), L.latLng(portalB.lat, portalB.lng)];
        tooltip = `<strong>${portalA.title} (A) <-> ${portalB.title} (B) (${distanceDisplay})</strong><hr />`;
    } else {
        const [originPortalId] = [...moveOrigins];
        fromPortal = originPortalId === portalA.id ? portalA : portalB;
        toPortal = originPortalId === portalA.id ? portalB : portalA;
        coords = [L.latLng(fromPortal.lat, fromPortal.lng), L.latLng(toPortal.lat, toPortal.lng)];
        tooltip = `<strong>${fromPortal.title} -> ${toPortal.title} (${distanceDisplay})</strong><hr />`;
    }

    const sortedLinks = [...shardPath.links].sort((a, b) => a.linkTime - b.linkTime);
    sortedLinks.forEach((link, index) => {
        const linkColor = FACTION_COLORS[link.team] || FACTION_COLORS.NEU;
        tooltip += `Linked at ${formatEpochToLocalTime(link.linkTime, timeZone)} by <span style="color:${linkColor}">${link.team || "NEU"}</span> <br />`;

        for (const move of link.moves) {
            const moveTime = formatEpochToLocalTime(move.moveTime, timeZone);
            const portalJumpText = biDirectionalMoves ? (move.origin === portalA.id ? "(A -> B)" : "(B -> A)") : "";
            tooltip += `<strong>Shard ${move.shardId}</strong> jumped ${portalJumpText} at ${moveTime} for ${move.points} point${move.points !== 1 ? 's' : ''}<br />`;
        }

        if (index < sortedLinks.length - 1) {
            tooltip += `<hr class="tooltip-sub-divider" />`;
        }
    });

    return { tooltip, coords, biDirectionalMoves };
}

function formatJumpPathTooltip(shardPath, shardPathPortals, timeZone) {
    const [portalA, portalB] = shardPathPortals;
    const jump = shardPath.jumps[0];
    const distanceDisplay = shardPath.distance < 1000 ? `${shardPath.distance}m` : `${(shardPath.distance / 1000).toFixed(2)}km`;

    const fromPortal = jump.origin === portalA.id ? portalA : portalB;
    const toPortal = jump.origin === portalA.id ? portalB : portalA;
    const coords = [L.latLng(fromPortal.lat, fromPortal.lng), L.latLng(toPortal.lat, toPortal.lng)];
    const moveTime = formatEpochToLocalTime(jump.moveTime, timeZone);

    const tooltip = `<strong>${fromPortal.title} -> ${toPortal.title} (${distanceDisplay})</strong><hr />
        <strong>Shard ${jump.shardId}</strong> randomly teleported at ${moveTime}<br />`;

    return { tooltip, coords };
}

export function getDetailsPanelContent(seriesId, siteId, waveId) {
    const seriesMetadata = getSeriesMetadata(seriesId);
    const siteGeocode = getSeriesGeocode(seriesId)?.sites[siteId];
    const siteData = getSiteData(seriesId, siteId);
    if (!siteData) return { title: '', content: '' };

    const siteEventType = EVENT_BRANDS[siteGeocode.eventType];
    const now = Date.now();
    const siteStartTime = new Date(siteGeocode.date.split('[')[0]).getTime();
    const siteEndTime = siteStartTime + (siteEventType.durationMins || 241) * 60000;
    let countdownSuffix = '';

    if (now < siteStartTime) {
        const remaining = getTimeRemaining(siteGeocode.date, siteGeocode.timezone);
        countdownSuffix = ` (Starts in ${remaining})`;
    } else if (now >= siteStartTime && now <= siteEndTime) {
        const remaining = getActiveEventRemaining(siteGeocode.date, siteGeocode.timezone, siteEventType.durationMins || 241);
        countdownSuffix = ` (Active: ${remaining} remaining)`;
    }

    const ornamentCount = Object.values(siteData.portals || {}).filter(p => p.ornamentId).length;
    const hasShards = siteData?.fullEvent?.shards?.length > 0;
    const isSingularEvent = !siteData.waves || siteData.waves.length <= 1;

    const contextPrefix = waveId ? `Wave ${waveId.replace('wave-', '')}: ` : (isSingularEvent ? '' : 'All waves: ');

    let content = `
        <div style="margin-bottom: 8px">
            Date: ${formatIsoToShortDate(siteGeocode.date, siteGeocode.timezone)}${countdownSuffix}${ornamentCount > 0 ? `<br/>Ornaments: ${ornamentCount}` : ''}
        </div>`;

    if (hasShards) {
        // Use specific wave counters if viewing a wave, otherwise use full event counters
        let currentCounters;
        if (waveId) {
            const waveIndex = parseInt(waveId.replace('wave-', '')) - 1;
            currentCounters = siteData.waves?.[waveIndex]?.counters;
        } else {
            currentCounters = siteData?.fullEvent?.counters;
        }

        let stats = [];
        if (currentCounters) {
            const shardCounters = currentCounters.shards || { nonMoving: 0, moving: 0 };
            const totalShards = (shardCounters.nonMoving || 0) + (shardCounters.moving || 0);
            if (totalShards > 0) {
                stats.push(`${totalShards} Shard${totalShards > 1 ? 's' : ''}`);
            }
            if (currentCounters.links > 0) stats.push(`${currentCounters.links} Link${currentCounters.links > 1 ? 's' : ''}`);
        }

        content += `
            <div style="margin-bottom: 12px; font-size: 0.9em; opacity: 0.8">
                <strong>${contextPrefix}</strong>${stats.join(' • ')}
            </div>
        `;
    }

    // Determine the actual time window of the shards event
    let actualStart = siteStartTime;
    let actualEnd = siteEndTime;

    if (siteData.waves && siteData.waves.length > 0) {
        const firstWave = siteData.waves[0];
        const lastWave = siteData.waves[siteData.waves.length - 1];
        if (firstWave.period && lastWave.period) {
            actualStart = firstWave.period.start;
            actualEnd = lastWave.period.end;
        }
    }

    content += getScoresText({
        seriesId,
        siteId,
        waveId,
        siteData,
        type: 'table',
        timezone: siteGeocode.timezone,
        eventStart: actualStart,
        eventEnd: actualEnd
    });

    const flagHtml = siteGeocode?.country_code ? getFlagTooltipHtml(siteGeocode?.country_code.toLowerCase()) : '';

    return {
        title: `<div style="text-align: center">${seriesMetadata?.name} ${siteEventType.label}<br/>${flagHtml} ${siteGeocode?.name}</div>`,
        content
    };
}

export function getScoresText({ seriesId, siteId, waveId, siteData, type = 'full', timezone, eventStart, eventEnd }) {
    if (!siteData) {
        siteData = getSiteData(seriesId, siteId);
    }
    if (type === 'table' && (!siteData.waves || siteData.waves.length <= 1)) {
        type = 'full';
    }

    const fullEventScores = siteData?.fullEvent?.scores;
    if (fullEventScores) {
        switch (type) {
            case 'simple':
                return renderSimpleScores(fullEventScores);
            case 'full':
                return renderFullScores(fullEventScores);
            case 'table':
                return renderTableScores(siteData.waves, fullEventScores, waveId, seriesId, siteId, timezone, eventStart, eventEnd);
        }
    }
    return '';
}

function renderSimpleScores(scores) {
    let html = `<span style="color:${FACTION_COLORS.RES}">${scores.RES}</span>:<span style="color:${FACTION_COLORS.ENL}">${scores.ENL}</span>`;
    if (scores.MAC > 0) {
        html += `:<span style="color:${FACTION_COLORS.MAC}">${scores.MAC}</span>`;
    }
    return html;
}

function renderFullScores(scores) {
    let html = `<span style="color:${FACTION_COLORS.RES}">RES: ${scores.RES} </span>
            <span style="color:${FACTION_COLORS.ENL}">ENL: ${scores.ENL} </span>`;
    if (scores.MAC > 0) {
        html += `<span style="color:${FACTION_COLORS.MAC}">MAC: ${scores.MAC}</span>`;
    }
    return html;
}

function renderTableScores(waves, totalScores, activeWaveId, seriesId, siteId, timezone, eventStart, eventEnd) {
    if (!waves || waves.length <= 1) return renderFullScores(totalScores);

    const hasMachinaScores = totalScores.MAC > 0 || waves.some(wave => wave.scores.MAC > 0);
    const prefix = seriesId + "-";
    const siteNavigationId = siteId.startsWith(prefix) ? siteId.substring(prefix.length) : siteId;

    let eventTimeRange = '';
    if (eventStart && eventEnd) {
        const start = formatEpochToLocalTime(eventStart, timezone);
        const end = formatEpochToLocalTime(eventEnd, timezone);
        eventTimeRange = `${start.split(':')[0]}:${start.split(':')[1]} - ${end.split(':')[0]}:${end.split(':')[1]}`;
    }

    let scoresHtml = `<table class='ingress-event-scores'>
        <thead>
            <tr data-series-id="${seriesId}" data-site-id="${siteNavigationId}">
                <th style="text-align: center">Wave</th>
                <th class='faction-RES'>RES</th>
                <th class='faction-ENL'>ENL</th>
                ${hasMachinaScores ? `<th class='faction-MAC'>MAC</th>` : ''}
            </tr>
        </thead>
        <tbody>`;

    waves.forEach((wave, index) => {
        const waveNumber = index + 1;
        const waveId = `wave-${waveNumber}`;
        const isHighlighted = activeWaveId === waveId;

        let waveTime = '';
        if (wave.period) {
            const start = formatEpochToLocalTime(wave.period.start, timezone);
            const end = formatEpochToLocalTime(wave.period.end, timezone);
            waveTime = `${start.split(':')[0]}:${start.split(':')[1]} - ${end.split(':')[0]}:${end.split(':')[1]}`;
        }

        scoresHtml += `<tr${isHighlighted ? ' class="highlight"' : ''} data-series-id="${seriesId}" data-site-id="${siteNavigationId}" data-wave-id="${waveId}">
            <th style="text-align: center" title="${waveTime}">${waveNumber}</th>
            <td>${wave.scores.RES}</td>
            <td>${wave.scores.ENL}</td>
            ${hasMachinaScores ? `<td>${wave.scores.MAC}</td>` : ''}
        </tr>`;
    });

    scoresHtml += `</tbody>
        <tfoot>
            <tr data-series-id="${seriesId}" data-site-id="${siteNavigationId}">
                <th style="text-align: center" title="${eventTimeRange}">Total</th>
                <td class='faction-RES'>${totalScores.RES}</td>
                <td class='faction-ENL'>${totalScores.ENL}</td>
                ${hasMachinaScores ? `<td class='faction-MAC'>${totalScores.MAC}</td>` : ''}
            </tr>
        </tfoot>
    </table>`;

    return scoresHtml;
}

export function updateAllPolylineStyles(map) {
    if (!map || !activeSiteLayer) return;

    activeSiteLayer.eachLayer(function (l) {
        if (l instanceof L.Polyline && l.biDirectionalJumps) {
            applyDynamicDashArray(l, map);
        }
    });
}

// Dynamically create the dashes on links where there are bi-directional jump
function applyDynamicDashArray(polyline, map) {
    const VISIBLE_PATTERN_PIXELS = 90;

    const latlngs = polyline.getLatLngs();
    let totalDistancePixels = 0;

    for (let i = 0; i < latlngs.length - 1; i++) {
        const startPoint = map.latLngToLayerPoint(latlngs[i]);
        const endPoint = map.latLngToLayerPoint(latlngs[i + 1]);
        totalDistancePixels += startPoint.distanceTo(endPoint);
    }

    const G_middle_pixels = Math.max(0, totalDistancePixels - VISIBLE_PATTERN_PIXELS);

    const dashArraySegments = [
        10, 5, 5, 5, 5, 5, 5, 5,
        G_middle_pixels,
        5, 5, 5, 5, 5, 5, 5, 10
    ];

    polyline.setStyle({
        dashArray: dashArraySegments.join(',')
    });
}
