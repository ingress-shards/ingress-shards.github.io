import * as L from "leaflet";
import { HISTORY_REASONS, FACTION_COLORS, INGRESS_INTEL_PORTAL_LINK, EVENT_BRANDS, RANDOM_TELEPORT_COLOR } from "../constants.js";
import shardIconUrl from '../../images/abaddon1_shard.png';
import { getSiteData, getSeriesMetadata, getSeriesGeocode } from "../data/data-store.js";
import { getFlagTooltipHtml } from "./ui-formatters.js"
import { formatEpochToLocalTime, formatIsoToShortDate } from "../shared/date-helpers.js";

const shardIcon = L.icon({
    iconUrl: shardIconUrl,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
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
        label: "All",
        layer: fullEventLayer,
    });

    siteData.waves && siteData.waves.forEach((wave, index) => {
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
    return layersDetails;
}

export function getSiteControl(siteId) {
    let controlLayers = {};
    for (const layerDetails of siteLayerCache.get(siteId)) {
        controlLayers[layerDetails.label] = layerDetails.layer;
    }
    return L.control.layers(controlLayers, {}, { collapsed: true, position: "bottomright" });
}

function renderShardLayer({ seriesId, siteId, shardData, portals, timezone, layerType }) {
    const shardLayer = L.featureGroup();
    shardLayer._layerType = layerType;
    shardLayer._siteId = siteId.replace(seriesId + "-", "");

    const shardPathsMap = createShardPathLayers(shardData.shardPaths, portals, timezone);
    shardPathsMap.values().forEach((shardPath) => shardPath.addTo(shardLayer));

    const { portalHistoryMap, shardMotionData } = processShardData(shardData.shards, portals);
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
                staticShardMarkers.push(L.marker(latLng, { icon: shardIcon }).bindTooltip(portalTooltip).bindPopup(portalTooltip));
            }
        });

        portalMarkers.push(
            L.circleMarker(latLng, {
                color: FACTION_COLORS[lastKnownTeam] || FACTION_COLORS.NEU,
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
    let tooltipHtml = `<strong>${portal.title}</strong> <a href="${INGRESS_INTEL_PORTAL_LINK}${portal.lat},${portal.lng}" target="intel_page">Intel</a><hr />`;

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
            color: RANDOM_TELEPORT_COLOR,
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

    let content = `Date: ${formatIsoToShortDate(siteGeocode.date, siteGeocode.timezone)}<br />Type: ${EVENT_BRANDS[siteGeocode.brand].name}<br />`;

    const totalShards = siteData.fullEvent.counters.shards.nonMoving + siteData.fullEvent.counters.shards.moving;
    if (totalShards > 1) {
        content += `Shards: ${totalShards}`;
        if (siteData.fullEvent.counters.shards.nonMoving > 0) {
            content += ` (${siteData.fullEvent.counters.shards.nonMoving} static)`;
        }
        content += '<br />';
    }
    if (siteData.fullEvent.counters.links > 0) {
        content += `Links: ${siteData.fullEvent.counters.links}<br />`;
    }
    content += getScoresText({ seriesId, siteId, waveId, siteData, type: 'table' });

    const flagHtml = siteGeocode?.country_code ? getFlagTooltipHtml(siteGeocode?.country_code.toLowerCase()) : '';

    return {
        title: `${seriesMetadata?.name}: ${flagHtml} ${siteGeocode?.name} Details`,
        content
    };
}

export function getScoresText({ seriesId, siteId, waveId, siteData, type = 'full' }) {
    if (!siteData) {
        siteData = getSiteData(seriesId, siteId);
    }
    if (type === 'table' && (!siteData.waves || siteData.waves.length <= 1)) {
        type = 'full';
    }

    const fullEventScores = siteData?.fullEvent.scores;
    if (fullEventScores) {
        switch (type) {
            case 'simple':
                return renderSimpleScores(fullEventScores);
            case 'full':
                return renderFullScores(fullEventScores);
            case 'table':
                return renderTableScores(siteData.waves, fullEventScores, waveId, seriesId, siteId);
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

function renderTableScores(waves, totalScores, activeWaveId, seriesId, siteId) {
    if (!waves || waves.length <= 1) return renderFullScores(totalScores);

    const hasMachinaScores = totalScores.MAC > 0 || waves.some(wave => wave.scores.MAC > 0);
    const siteNavigationId = siteId.replace(seriesId + "-", "");

    let scoresHtml = `<table class='ingress-event-scores'>
        <thead>
            <tr>
                <th>Wave</th>
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
        scoresHtml += `<tr${isHighlighted ? ' class="highlight"' : ''} data-series-id="${seriesId}" data-site-id="${siteNavigationId}" data-wave-id="${waveId}">
            <th>${waveNumber}</th>
            <td>${wave.scores.RES}</td>
            <td>${wave.scores.ENL}</td>
            ${hasMachinaScores ? `<td>${wave.scores.MAC}</td>` : ''}
        </tr>`;
    });

    scoresHtml += `</tbody>
        <tfoot>
            <tr>
                <th>Total</th>
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
