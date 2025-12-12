import * as L from "leaflet";
import { HISTORY_REASONS, FACTION_COLORS, INGRESS_INTEL_PORTAL_LINK, SHARD_EVENT_TYPE } from "../constants.js";
import shardIconUrl from '../../assets/abaddon1_shard.png';
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
        console.log('siteData', seriesId, siteId, siteData);
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
    console.log(siteLayerCache.get(siteId));
    let controlLayers = {};
    for (const layerDetails of siteLayerCache.get(siteId)) {
        controlLayers[layerDetails.label] = layerDetails.layer;
    }
    return L.control.layers(controlLayers, {}, { collapsed: true, position: "bottomright" });
}

function renderShardLayer({ seriesId, siteId, shardData, portals, timezone, layerType }) {
    const shardLayer = L.featureGroup();
    console.log(shardData);
    shardLayer._layerType = layerType;
    shardLayer._siteId = siteId.replace(seriesId + "-", "");

    const linkPathsMap = renderLinkPathData(shardData.linkPaths, portals, timezone);
    linkPathsMap.values().forEach((linkPath) => linkPath.addTo(shardLayer));

    const shardDetails = renderShardData(shardData.shards, portals);

    shardLayer.shardMotionPaths = [];
    shardDetails.shardPaths.forEach((shardPath) => {
        shardPath.addTo(shardLayer);

        shardLayer.shardMotionPaths.push(shardPath);

        for (const linkPath of shardPath.linkPaths) {
            const link = linkPathsMap.get(linkPath);
            link.shardPath = shardPath;
            link.on("mouseover", function () {
                shardPath.motionStart();
            });
        }
    });

    shardLayer.startShardMotion = function () {
        this.shardMotionPaths.forEach(shardPath => {
            shardPath.motionStart();
        });
    };

    const portalHistoryMap = shardDetails.portalHistoryMap;
    const portalDetails = renderPortalData(portals, portalHistoryMap, timezone);
    portalDetails.markers.forEach((marker) => marker.addTo(shardLayer));
    portalDetails.staticShards.forEach((marker) => marker.addTo(shardLayer));

    return shardLayer;
}

function renderLinkPathData(linkPaths, portalsMap, timezone) {
    const linkPathsMap = new Map();

    for (const [linkPathKey, linkPath] of Object.entries(linkPaths)) {
        const linkPathPortals = linkPathKey.split("-").map(idString => {
            const id = Number(idString);
            return {
                id,
                ...(portalsMap[id]),
            }
        });

        const linkPathDetails = renderLinkPath(linkPath, linkPathPortals, timezone);
        linkPathsMap.set(linkPathKey, linkPathDetails);
    }
    return linkPathsMap;
}

function renderShardData(shards, portalsMap) {
    const portalHistoryMap = {};
    const shardPaths = [];

    for (const shard of shards) {
        const coords = [];
        const linkPaths = [];

        for (const historyItem of shard.history) {
            const portalIds = historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP
                ? [historyItem.portalId, historyItem.dest]
                : [historyItem.portalId];

            if (historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP) {
                const originPortal = portalsMap[historyItem.portalId];
                const destPortal = portalsMap[historyItem.dest];

                linkPaths.push([historyItem.portalId, historyItem.dest].sort().join('-'));
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

        if (linkPaths.length > 0) {
            const shardPath =
                L.motion.polyline(
                    coords,
                    {
                        color: "transparent",
                        interactive: false,
                    },
                    { auto: false, duration: linkPaths.length * 1000 },
                    {
                        showMarker: true,
                        removeOnEnd: false,
                        icon: shardIcon,
                        interactive: false,
                    }
                );
            shardPath.linkPaths = linkPaths;
            shardPaths.push(shardPath);
        }
    }

    return {
        shardPaths,
        portalHistoryMap,
    };
}

function renderPortalData(portals, portalHistoryMap, timeZone) {
    const markers = [];
    const staticShards = [];

    for (const [portalId, portal] of Object.entries(portals)) {
        const latLng = L.latLng(portal.lat, portal.lng);

        const portalHistory = Array.from(portalHistoryMap[portalId] || []);
        if (portalHistory.length === 0) continue;
        const lastKnownTeam = getLastKnownTeam(portalHistory);

        let portalTooltip = `<strong>${portal.title}</strong> <a href="${INGRESS_INTEL_PORTAL_LINK}${portal.lat},${portal.lng}" target="intel_page">Intel</a><hr />`;

        portalHistory.forEach(([shardId, shardHistory], index) => {
            portalTooltip += `<strong>Shard ${shardId}</strong><br />`;
            for (const historyItem of shardHistory) {
                let teamToDisplay =
                    historyItem.reason !== HISTORY_REASONS.NO_MOVE
                        ? historyItem.team || "NEU"
                        : undefined;

                portalTooltip += `${historyItem.reason === HISTORY_REASONS.LINK ? HISTORY_REASONS.JUMP : historyItem.reason
                    } at ${formatEpochToLocalTime(historyItem.moveTime, timeZone)}
                    ${teamToDisplay
                        ? ` - <span style="color:${FACTION_COLORS[teamToDisplay]}">${teamToDisplay}</span>`
                        : ""
                    }
                    <br />`;
            }

            if (index !== portalHistory.length - 1) {
                portalTooltip += `<hr class="tooltip-sub-divider" />`;
            }

            const shardHistoryReasons = shardHistory.flatMap((h) => h.reason);
            if (
                shardHistoryReasons.includes(HISTORY_REASONS.SPAWN) &&
                !(shardHistoryReasons.includes(HISTORY_REASONS.LINK) || shardHistoryReasons.includes(HISTORY_REASONS.JUMP))
            ) {
                staticShards.push(L.marker(latLng, { icon: shardIcon }).bindTooltip(portalTooltip).bindPopup(portalTooltip));
            }
        });
        markers.push(
            L.circleMarker(latLng, {
                color: FACTION_COLORS[lastKnownTeam] || FACTION_COLORS.NEU,
            }).bindTooltip(portalTooltip, {
                interactive: true
            }).bindPopup(portalTooltip, {
                closeButton: false,
                autoClose: true
            })
        );
    }
    return {
        markers,
        staticShards,
    };
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

function renderLinkPath(linkPath, linkPathPortals, timeZone) {
    const [portalA, portalB] = linkPathPortals;
    let linkTooltip;

    const jumpOrigins = new Set(linkPath.links.flatMap(link => link.jumps).map(jump => jump.origin));
    const biDirectionalJumps = jumpOrigins.size > 1;
    const distanceDisplay = linkPath.distance < 1000 ? `${linkPath.distance}m` : `${(linkPath.distance / 1000).toFixed(2)}km`;
    let coords;
    if (biDirectionalJumps) {
        coords = [L.latLng(portalA.lat, portalA.lng), L.latLng(portalB.lat, portalB.lng)];
        linkTooltip = `<strong>${portalA.title} (A) <-> ${portalB.title} (B) (${distanceDisplay})</strong><hr />`;
    } else {
        const [originPortal] = [...jumpOrigins];
        const fromPortal = originPortal === portalA.id ? portalA : portalB;
        const toPortal = originPortal === portalA.id ? portalB : portalA;
        coords = [L.latLng(fromPortal.lat, fromPortal.lng), L.latLng(toPortal.lat, toPortal.lng)];
        linkTooltip = `<strong>${fromPortal.title} -> ${toPortal.title} (${distanceDisplay})</strong><hr />`;
    }

    let linkColor;
    const sortedLinks = linkPath.links.sort((a, b) => a.linkTime - b.linkTime);
    for (const [index, link] of sortedLinks.entries()) {
        if (linkColor && FACTION_COLORS[link.team] !== linkColor) {
            let multipleLinkDifferentFactionWarningMessage = `New link with different team!
            \t${portalA.title} (${portalA.lat},${portalA.lng}) -> ${portalB.title} (${portalB.lat},${portalB.lng})
            \tPrevious ${linkColor}, current ${FACTION_COLORS[link.team]} (${link.team})`;
            if (biDirectionalJumps) {
                multipleLinkDifferentFactionWarningMessage += "\nThere are bidirectional jumps too!";
            }
            console.debug(multipleLinkDifferentFactionWarningMessage);
        }
        linkColor = FACTION_COLORS[link.team] || FACTION_COLORS.NEU;

        linkTooltip += `Linked at ${formatEpochToLocalTime(link.linkTime, timeZone)} by <span style="color:${linkColor}">${link.team || "NEU"}</span> <br />`;

        for (const jump of link.jumps) {
            const moveTime = formatEpochToLocalTime(jump.moveTime, timeZone);
            const portalJumpText = biDirectionalJumps ? jump.origin === portalA.id ? "(A -> B)" : "(B -> A)" : "";

            linkTooltip += `<strong>Shard ${jump.shardId}</strong> jumped ${portalJumpText} at ${moveTime} for ${jump.points} point${jump.points !== 1 ? 's' : ''}<br />`
        }

        if (index !== sortedLinks.length - 1) {
            linkTooltip += `<hr class="tooltip-sub-divider" />`;
        }
    }

    const polyline = L.polyline(
        coords,
        {
            color: linkColor,
            dashArray: ["10,5,5,5,5,5,5,5,10000"],
        }
    );
    polyline.biDirectionalJumps = biDirectionalJumps;
    polyline.bindTooltip(linkTooltip, { sticky: true });
    polyline.bindPopup(linkTooltip, { sticky: true });

    return polyline;
}

export function getDetailsPanelContent(seriesId, siteId, waveId) {
    const seriesMetadata = getSeriesMetadata(seriesId);
    const siteGeocode = getSeriesGeocode(seriesId)?.sites[siteId];
    const siteData = getSiteData(seriesId, siteId);

    let content = `Date: ${formatIsoToShortDate(siteGeocode.date, siteGeocode.timezone)}<br />Type: ${SHARD_EVENT_TYPE[siteGeocode.type].name}<br />`;

    const totalShards = siteData.fullEvent.counters.shards.nonMoving + siteData.fullEvent.counters.shards.moving;
    if (totalShards > 1) {
        content += `Shards: ${totalShards}`;
        if (siteData.fullEvent.counters.shards.nonMoving > 0) {
            content += ` (${siteData.fullEvent.counters.shards.nonMoving} static)`;
        }
        content += '<br />';
    }
    content += `Links: ${siteData.fullEvent.counters.links} links<br />`;
    content += getScoresText({ seriesId, siteId, waveId, siteData, type: 'table' });

    const flagHtml = siteGeocode?.country_code ? getFlagTooltipHtml(siteGeocode?.country_code.toLowerCase()) : '';

    return {
        title: `${seriesMetadata?.name}: ${flagHtml} ${siteGeocode?.location} Details`,
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

    let fulLEventScores = siteData?.fullEvent.scores;
    let scoresHtml = '';
    if (fulLEventScores) {
        switch (type) {
            case 'simple':
                scoresHtml = `
                <span style="color:${FACTION_COLORS.RES}">${fulLEventScores.RES}</span>:<span style="color:${FACTION_COLORS.ENL}">${fulLEventScores.ENL}</span>:<span style="color:${FACTION_COLORS.MAC}">${fulLEventScores.MAC}</span>`;
                break;
            case 'full':
                scoresHtml = `
                <span style="color:${FACTION_COLORS.RES}">RES: ${fulLEventScores.RES} </span>
                <span style="color:${FACTION_COLORS.ENL}">ENL: ${fulLEventScores.ENL} </span>
                <span style="color:${FACTION_COLORS.MAC}">MAC: ${fulLEventScores.MAC}</span>`;
                break;
            case 'table':
                if (siteData.waves && siteData.waves.length > 1) {
                    scoresHtml = `<table class='ingress-event-scores'>
                    <thead>
                        <tr>
                            <th>Wave</th>
                            <th class='faction-RES'>RES</th>
                            <th class='faction-ENL'>ENL</th>
                            <th class='faction-MAC'>MAC</th>
                        </tr>
                    </thead>`;
                    scoresHtml += '<tbody>';
                    siteData.waves.forEach((wave, index) => {
                        const waveNumber = index + 1;
                        if (waveId === `wave-${waveNumber}`) {
                            scoresHtml += '<tr class="highlight">';
                        } else {
                            scoresHtml += '<tr>';
                        }
                        scoresHtml += `
                        <th>${waveNumber}</th>
                        <td>${wave.scores.RES}</td>
                        <td>${wave.scores.ENL}</td>
                        <td>${wave.scores.MAC}</td>
                    </tr>`;
                    });
                    scoresHtml += '</tbody>';
                    scoresHtml += `<tfoot>
                    <tr>
                        <th>Total</th>
                        <td class='faction-RES'>${fulLEventScores.RES}</td>
                        <td class='faction-ENL'>${fulLEventScores.ENL}</td>
                        <td class='faction-MAC'>${fulLEventScores.MAC}</td>
                    </tr>
                </tfoot>`;
                    scoresHtml += '</table>';
                }
                break;
        }
    }
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
