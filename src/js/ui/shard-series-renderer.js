import { HISTORY_REASONS, FACTION_COLORS } from "../constants.js";
import shardIconUrl from '../../assets/abaddon1_shard.png';

const shardIcon = L.icon({
    iconUrl: shardIconUrl,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
});

export async function renderSeriesData(name, shardEventData) {
    const startTime = performance.now();
    const siteLayers = [];

    let controlsHtml = `<div id="${name}" class="series" style="display:none">`;

    console.log(`Rendering sites for series: ${name}`);
    for (const site of shardEventData.sites) {
        const siteLayer = L.featureGroup();
        siteLayer.data = site;

        const linkPathsMap = renderLinkPathData(site.linkPaths, site.portals, site.timezone);
        linkPathsMap.values().forEach((linkPath) => linkPath.addTo(siteLayer));

        const shardDetails = renderShardData(site.shards, site.portals);
        shardDetails.shardPaths.forEach((shardPath) => {
            shardPath.addTo(siteLayer);

            for (const linkPath of shardPath.linkPaths) {
                const link = linkPathsMap.get(linkPath);
                link.shardPath = shardPath;
                link.on("mouseover", function (e) {
                    shardPath.motionStart();
                });
            }
        });

        const portalHistoryMap = shardDetails.portalHistoryMap;
        const portalDetails = renderPortalData(site.portals, portalHistoryMap, site.timezone);
        portalDetails.markers.forEach((marker) => marker.addTo(siteLayer));
        portalDetails.staticShards.forEach((marker) => marker.addTo(siteLayer));

        siteLayers.push(siteLayer);

        console.debug(
            `${site.name} site details: ${shardDetails.portalHistoryMap.size} portals, ${site.shards.length} shards (${portalDetails.staticShards.length} static), ${linkPathsMap.size} link paths.`
        );

        const uniqueSiteId = name + "_" + site.id.replace(" ", "_");
        const scoresHtml = `<span style="color:${FACTION_COLORS.RES}">${site.linkScores.RES}</span>:<span style="color:${FACTION_COLORS.ENL}">${site.linkScores.ENL}</span>:<span style="color:${FACTION_COLORS.MAC}">${site.linkScores.MAC}</span>:<span style="color:${FACTION_COLORS.NEU}">${site.linkScores.NEU}</span>`;
        controlsHtml += `<button id="${uniqueSiteId}">${site.name}</button> ${scoresHtml}<br>`;
    }
    controlsHtml += "</div>";
    $("#controls").append(controlsHtml);

    const endTime = performance.now();
    console.debug(
        `Render of ${name} (${shardEventData.sites.length} sites) complete in ${(endTime - startTime) / 1000} seconds`
    );
    return siteLayers;
}

function renderLinkPathData(linkPaths, portalsMap, timezone) {
    const linkPathsMap = new Map();

    for (const [linkPathKey, linkPath] of linkPaths) {
        const linkPathPortals = linkPathKey.split("-").map(idString => {
            const id = Number(idString);
            return {
                id,
                ...(portalsMap.get(id)),
            }
        });

        const linkPathDetails = renderLinkPath(linkPath, linkPathPortals, timezone);
        linkPathsMap.set(linkPathKey, linkPathDetails);
    }
    return linkPathsMap;
}

function renderShardData(shards, portalsMap) {
    const portalHistoryMap = new Map();
    const shardPaths = [];

    for (const shard of shards) {
        const coords = [];
        const linkPaths = [];

        for (const historyItem of shard.history) {
            const portalIds = historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP
                ? [historyItem.portalId, historyItem.dest]
                : [historyItem.portalId];

            if (historyItem.reason === HISTORY_REASONS.LINK || historyItem.reason === HISTORY_REASONS.JUMP) {
                const originPortal = portalsMap.get(historyItem.portalId);
                const destPortal = portalsMap.get(historyItem.dest);

                linkPaths.push([historyItem.portalId, historyItem.dest].sort().join('-'));
                if (coords.length === 0) {
                    coords.push(L.latLng(originPortal.lat, originPortal.lng));
                }
                coords.push(L.latLng(destPortal.lat, destPortal.lng));
            }

            for (const portalId of portalIds) {
                if (!portalHistoryMap.has(portalId)) {
                    portalHistoryMap.set(portalId, new Map());
                }
                const portalHistory = portalHistoryMap.get(portalId);
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
                    { auto: true, duration: linkPaths.length * 1000 },
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

    for (const [portalId, portal] of portals) {
        const latLng = L.latLng(portal.lat, portal.lng);

        const portalHistory = Array.from(portalHistoryMap.get(portalId) || []);
        const lastKnownTeam = getLastKnownTeam(portalHistory);

        let portalTooltip = `<strong>${portal.title}</strong><hr />`;

        portalHistory.forEach(([shardId, shardHistory], index) => {
            portalTooltip += `<strong>Shard ${shardId}</strong><br />`;
            for (const historyItem of shardHistory) {
                let teamToDisplay =
                    historyItem.reason !== HISTORY_REASONS.NO_MOVE
                        ? historyItem.team || "NEU"
                        : undefined;

                portalTooltip += `${historyItem.reason === HISTORY_REASONS.LINK ? HISTORY_REASONS.JUMP : historyItem.reason
                    } at ${new Date(parseInt(historyItem.moveTime) * 1000).toLocaleString(navigator.language, {
                        timeZone,
                    })}${teamToDisplay
                        ? ` - <span style="color:${FACTION_COLORS[teamToDisplay]}">${teamToDisplay}</span>`
                        : ""
                    } <br />`;
            }

            if (index !== portalHistory.length - 1) {
                portalTooltip += `<hr class="tooltip-sub-divider" />`;
            }

            const shardHistoryReasons = shardHistory.flatMap((h) => h.reason);
            if (
                shardHistoryReasons.includes(HISTORY_REASONS.SPAWN) &&
                !(shardHistoryReasons.includes(HISTORY_REASONS.LINK) || shardHistoryReasons.includes(HISTORY_REASONS.JUMP))
            ) {
                staticShards.push(L.marker(latLng, { icon: shardIcon }).bindTooltip(portalTooltip));
            }
        });
        markers.push(
            L.circleMarker(latLng, {
                color: FACTION_COLORS[lastKnownTeam] || FACTION_COLORS.NEU,
            }).bindTooltip(portalTooltip)
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
        .map(([_shardId, historyItems]) => historyItems)
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
    let coords;
    if (biDirectionalJumps) {
        coords = [L.latLng(portalA.lat, portalA.lng), L.latLng(portalB.lat, portalB.lng)];
        linkTooltip = `<strong>${portalA.title} (A) <-> ${portalB.title} (B) (${linkPath.distance}m)</strong><hr />`;
    } else {
        const [originPortal] = [...jumpOrigins];
        const fromPortal = originPortal === portalA.id ? portalA : portalB;
        const toPortal = originPortal === portalA.id ? portalB : portalA;
        coords = [L.latLng(fromPortal.lat, fromPortal.lng), L.latLng(toPortal.lat, toPortal.lng)];
        linkTooltip = `<strong>${fromPortal.title} -> ${toPortal.title} (${linkPath.distance}m)</strong><hr />`;
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

        const linkCreationTimeMs = new Date(parseInt(link.linkTime) * 1000).toLocaleString(
            navigator.language, {
            timeZone,
        });
        linkTooltip += `Link time: ${linkCreationTimeMs} - <span style="color:${linkColor}">${link.team || "NEU"}</span> <br />`;

        for (const jump of link.jumps) {
            const moveTimeMs = new Date(parseInt(jump.moveTime) * 1000).toLocaleString(navigator.language, {
                timeZone,
            });

            const portalJumpText = biDirectionalJumps ? jump.origin === portalA.id ? "(A -> B)" : "(B -> A)" : "";
            linkTooltip += `<strong>Shard ${jump.shardId}</strong> ${portalJumpText} at ${moveTimeMs} - ${jump.points} point${jump.points !== 1 ? 's' : ''}<br />`
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
