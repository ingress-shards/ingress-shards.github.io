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

        const shardDetails = renderShardData(site.shards, site.portals);
        shardDetails.links.forEach((link) => link.addTo(siteLayer));
        shardDetails.paths.forEach((path) => path.addTo(siteLayer));

        const portalHistoryMap = shardDetails.portalHistoryMap;
        const portalDetails = renderPortalData(site.portals, portalHistoryMap, site.timezone);
        portalDetails.markers.forEach((marker) => marker.addTo(siteLayer));
        portalDetails.staticShards.forEach((marker) => marker.addTo(siteLayer));

        siteLayers.push(siteLayer);

        console.debug(
            `${site.name} site details: ${shardDetails.portalHistoryMap.size} portals, ${site.shards.length} shards (${portalDetails.staticShards.length} static), ${shardDetails.links.length} links.`
        );

        const uniqueSiteId = name + "_" + site.id.replace(" ", "_");
        const scoresHtml = `<span style="color:${FACTION_COLORS.RES}">${site.linkScores.RES}</span>:<span style="color:${FACTION_COLORS.ENL}">${site.linkScores.ENL}</span>:<span style="color:${FACTION_COLORS.MAC}">${site.linkScores.MAC}</span>:<span style="color:${FACTION_COLORS.NEU}">${site.linkScores.NEU}</span>`;
        controlsHtml += `<button id="${uniqueSiteId}">${site.name}</button> ${scoresHtml}<br>`;
    }
    controlsHtml += "</div>";
    $("#controls").append(controlsHtml);

    const endTime = performance.now();
    console.debug(
        `Render of ${name} (${shardEventData.sites.length} sites) complete in ${endTime - startTime
        } milliseconds`
    );
    return siteLayers;
}

function renderShardData(shards, portalsMap) {
    const portalHistoryMap = new Map();
    const allLinks = [];
    const shardPaths = [];

    for (const shard of shards) {
        const shardLinks = [];
        for (const historyItem of shard.history) {
            let portalIds = [];
            switch (historyItem.reason) {
                case HISTORY_REASONS.LINK:
                case HISTORY_REASONS.JUMP:
                    portalIds.push(historyItem.linkDetails.origin, historyItem.linkDetails.dest);
                    const originPortal = portalsMap.get(historyItem.linkDetails.origin);
                    const destPortal = portalsMap.get(historyItem.linkDetails.dest);

                    shardLinks.push(
                        renderLink({
                            ...historyItem.linkDetails,
                            originPortal,
                            destPortal,
                            shardId: shard.id,
                            moveTime: historyItem.moveTime,
                        })
                    );
                    break;
                default:
                    portalIds.push(historyItem.portalId);
                    break;
            }

            for (const portalId of portalIds) {
                if (!portalHistoryMap.has(portalId)) {
                    portalHistoryMap.set(portalId, new Map());
                }
                const portalHistory = portalHistoryMap.get(portalId);
                if (!portalHistory.has(shard.id)) {
                    portalHistory.set(shard.id, []);
                }
                portalHistoryMap.get(portalId).get(shard.id).push(historyItem);
            }
        }

        if (shardLinks.length > 0) {
            const coords = shardLinks.flatMap((link) => link.getLatLngs());

            const shardPath = [
                L.motion.polyline(
                    coords,
                    {
                        color: "transparent",
                        interactive: false,
                    },
                    { auto: true, duration: shardLinks.length * 1000 },
                    {
                        showMarker: true,
                        removeOnEnd: false,
                        icon: shardIcon,
                        interactive: false,
                    }
                ),
            ];

            for (const link of shardLinks) {
                link.shardPath = shardPath;
                link.on("mouseover", function (e) {
                    this.shardPath.forEach((s) => s.motionStart());
                });
            }
            shardPaths.push(...shardPath);
            allLinks.push(...shardLinks);
        }
    }

    return {
        links: allLinks,
        paths: shardPaths,
        portalHistoryMap,
    };
}

function renderPortalData(portals, portalHistoryMap, timeZone) {
    const markers = [];
    const staticShards = [];

    for (const [portalId, portal] of portals) {
        const latLng = L.latLng(portal.lat, portal.lng);

        const portalHistory = portalHistoryMap.get(portalId);
        const lastKnownTeam = getLastKnownTeam(portalHistory);

        let portalTooltip = `<strong>${portal.title}</strong><br />`;
        for (const [shardId, shardHistory] of portalHistory || []) {
            portalTooltip += `<hr /><strong>Shard ${shardId}</strong><br />`;
            for (const historyItem of shardHistory) {
                let teamToDisplay =
                    historyItem.reason !== HISTORY_REASONS.NO_MOVE
                        ? historyItem.team || historyItem.linkDetails?.team || "NEU"
                        : undefined;

                portalTooltip += `${historyItem.reason === HISTORY_REASONS.LINK ? HISTORY_REASONS.JUMP : historyItem.reason
                    } at ${new Date(parseInt(historyItem.moveTime) * 1000).toLocaleString(navigator.language, {
                        timeZone,
                    })}${teamToDisplay
                        ? ` - <span style="color:${FACTION_COLORS[teamToDisplay]}">${teamToDisplay}</span>`
                        : ""
                    } <br />`;
            }

            const shardHistoryReasons = shardHistory.flatMap((h) => h.reason);
            if (
                shardHistoryReasons.includes(HISTORY_REASONS.SPAWN) &&
                !(shardHistoryReasons.includes(HISTORY_REASONS.LINK) || shardHistoryReasons.includes(HISTORY_REASONS.JUMP))
            ) {
                staticShards.push(L.marker(latLng, { icon: shardIcon }).bindTooltip(portalTooltip));
            }
        }
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

    const portalHistoryEntries = [...portalHistory.values()]
        .flatMap((historyItem) => historyItem || [])
        .filter(
            (historyItem) =>
                historyItem.reason !== "despawn" && (historyItem.team || historyItem.linkDetails?.team)
        )
        .sort((a, b) => b.moveTime - a.moveTime);

    return portalHistoryEntries[0]?.team || portalHistoryEntries[0]?.linkDetails?.team;
}

function renderLink(linkMetadata) {
    const originPortal = linkMetadata.originPortal;
    const destPortal = linkMetadata.destPortal;
    const linkColor = FACTION_COLORS[linkMetadata.team] || FACTION_COLORS.NEU;

    const polyline = L.polyline(
        [L.latLng(originPortal.lat, originPortal.lng), L.latLng(destPortal.lat, destPortal.lng)],
        {
            color: linkColor,
            dashArray: ["10,5,5,5,5,5,5,5,100000"],
        }
    );

    const linkCreationTimeMs = new Date(parseInt(linkMetadata.linkTime) * 1000).toLocaleString(
        navigator.language,
        {
            timeZone: originPortal.timezone,
        }
    );
    const moveTimeMs = new Date(parseInt(linkMetadata.moveTime) * 1000).toLocaleString(navigator.language, {
        timeZone: originPortal.timezone,
    });
    const linkTooltip = `<strong>Shard ${linkMetadata.shardId}</strong><br />${originPortal.title} -> ${destPortal.title
        }<br>Link time: ${linkCreationTimeMs}<br />Jump time: ${moveTimeMs}<br />Distance: ${(
            Math.round((linkMetadata.distance + Number.EPSILON) * 100) / 100
        ).toLocaleString()}m<br />Points: ${linkMetadata.points}`;
    polyline.bindTooltip(linkTooltip, { sticky: true });
    polyline.bindPopup(linkTooltip, { sticky: true });

    return polyline;
}
