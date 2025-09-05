export const SHARD_EVENT_TYPE = {
    SKIRMISH: "skirmish",
    SINGULAR: "singular",
    ANOMALY: "anomaly",
};
export const TEAM_ABBREVIATIONS = {
    "RESISTANCE": "RES",
    "ENLIGHTENED": "ENL",
    "MACHINA": "MAC",
}
export const HISTORY_REASONS = {
    SPAWN: "spawn",
    NO_MOVE: "no move",
    LINK: "link",
    JUMP: "jump",
    DESPAWN: "despawn",
};

export function getAbbreviatedTeam(fullTeamName) {
    return TEAM_ABBREVIATIONS[fullTeamName];
}

export var shard_singulars = [
    "🇦🇺 Hervey Bay, Australia",
    "🇦🇺 Hobart, Australia",
    "🇯🇵 Niigata, Japan",
    "🇯🇵 Shizuoka, Japan",
    "🇨🇳 Shanghai (Baoshan District), China",
    "🇲🇾 Kota Kinabalu, Malaysia",
    "🇭🇰 Tuen Mun, Hong Kong",
    "🇸🇬 Bedok, Singapore",
    "🇨🇱 Santiago, Chile",
    "🇵🇪 Lima, Peru",
    "🇨🇦 Toronto, Canada",
    "🇨🇷 San Jose, Costa Rica",
    "🇲🇽 Monterrey, Mexico",
    "🇺🇸 Salt Lake City, UT, USA",
    "🇺🇸 Las Vegas, NV, USA",
    "🇺🇸 San Diego, CA, USA",
    "🇳🇿 Greymouth, New Zealand",
    "🇯🇵 Shimonoseki, Japan",
    "🇰🇷 Incheon, South Korea",
    "🇮🇩 Makassar, Indonesia",
    "🇹🇼 Kinmen, Taiwan",
    "🇨🇳 Tianjin, China",
    "🇲🇴 Macao",
    "🇲🇻 Male, Maldives",
    "🇦🇪 Dubai, United Arab Emirates",
    "🇧🇬 Sofia, Bulgaria",
    "🇨🇿 Ostrava, Czechia",
    "🇸🇰 Bratislava, Slovakia",
    "🇳🇱 Delfzijl, Netherlands",
    "🇳🇴 Stavanger, Norway",
    "🇧🇪 Ghent, Belgium",
    "🇪🇸 Zaragoza, Spain",
    "🇱🇻 Riga, Latvia",
    "🇿🇦 Cape Town, South Africa",
    "🇵🇱 Poznań, Poland",
    "🇮🇹 Fiumicino, Italy",
    "🇩🇪 Nürnberg, Germany",
    "🇫🇷 Lyon, France",
    "🇬🇧 Plymouth, UK",
    "🇵🇹 Lisboa, Portugal",
    "🇧🇷 Recife, Brazil",
    "🇧🇷 Rio de Janeiro, Brazil",
    "🇨🇴 Cartagena, Colombia",
    "🇺🇸 Orlando, FL, USA",
    "🇺🇸 Columbus, OH, USA",
    "🇺🇸 Milwaukee, WI, USA",
    "🇺🇸 Fort Worth, TX, USA",
    "🇨🇦 Vancouver, Canada",
];
export const linkScoringRules = new Map()
    .set(SHARD_EVENT_TYPE.SINGULAR, {
        rules: [
            {
                description:
                    "3 points for a single jump over a Link longer than 100km. No further points will be given for subsequent jumps by that Shard.",
                jumpPoints: 0,
                minDistance: 100000,
                maxDistance: Infinity,
                linkLengthPoints: 3,
                allowFurtherPoints: false,
            },
            {
                description: "1 point for each jump over a Link between 1km and 5km in length.",
                jumpPoints: 0,
                minDistance: 1000,
                maxDistance: 5000,
                linkLengthPoints: 1,
                allowFurtherPoints: true,
            },
        ],
    })
    .set(SHARD_EVENT_TYPE.SKIRMISH, {
        rules: [
            {
                description: "1 point for a single jump over a Link longer than 249.5m.",
                jumpPoints: 0,
                minDistance: 249.5,
                maxDistance: Infinity,
                linkLengthPoints: 1,
                allowFurtherPoints: true,
            },
        ],
    })
    .set(SHARD_EVENT_TYPE.ANOMALY, {
        rules: [
            {
                description: "1 point for a single jump.",
                jumpPoints: 1,
                minDistance: 0,
                maxDistance: Infinity,
                linkLengthPoints: 0,
                allowFurtherPoints: true,
            },
        ],
    });

// A function to convert Niantic's shard jump times json into a more usable format for display on a map.
export function processShardSeriesData(name, json) {
    const artifacts = json.artifact.filter((d) => d.fragment);
    if (!artifacts.length) {
        console.warn(`No artifacts found with shards for ${name}. Skipping processing.`);
        return [];
    }

    artifacts.sort((a, b) => a.name.localeCompare(b.name));
    let sites = [];
    for (const artifact of artifacts) {
        if (!artifact.city && !name.includes("singular")) {
            // console.debug(`Skipping shard singular event ${artifact.id} to separate in drop down box`);
            continue;
        }
        if (artifact.city && name.includes("singular")) {
            // console.debug(
            //     `Skipping shard skirmish ${artifact.id} (${artifact.city}) to separate in drop down box`
            // );
            continue;
        }

        const anomalySeriesNames = [
            "theta_2025_06_14",
            "delta_2025_08_16",
            "delta_2025_08_23",
            "delta_2025_09_20",
        ];

        const sortedFragments = artifact.fragment.sort((a, b) => a.id.localeCompare(b.id));
        let site;
        for (const [index, fragment] of sortedFragments.entries()) {
            let siteDetails;
            if (artifact.city) {
                const eventType = anomalySeriesNames.some((nameToFind) => name.includes(nameToFind))
                    ? SHARD_EVENT_TYPE.ANOMALY
                    : SHARD_EVENT_TYPE.SKIRMISH;
                siteDetails = {
                    ...artifact,
                    eventType,
                };
            } else {
                siteDetails = {
                    ...fragment,
                    city: getShardSingularCity(name, index),
                    eventType: SHARD_EVENT_TYPE.SINGULAR,
                };
            }
            site = sites.find(site => site.id === siteDetails.id);
            if (!site) {
                site = createSite(siteDetails);
                sites.push(site);
            }
            const shardId = parseInt(fragment.id.includes('_') ? fragment.id.slice(fragment.id.lastIndexOf('_') + 1) : fragment.id, 10);

            const shardHistory = fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs));
            let mostRecentShardPortalKey;
            let shardEntries = [];
            let allowFurtherPoints = true;
            for (const historyItem of shardHistory) {
                const originPortalKey =
                    historyItem.originPortalInfo &&
                    `${historyItem.originPortalInfo.latE6}_${historyItem.originPortalInfo.lngE6}`;
                const destPortalKey =
                    historyItem.destinationPortalInfo &&
                    `${historyItem.destinationPortalInfo.latE6}_${historyItem.destinationPortalInfo.lngE6}`;

                let originPortalId, destPortalId;
                switch (historyItem.reason) {
                    case HISTORY_REASONS.SPAWN:
                        /*
                            Create a new shard entry if a spawn entry is found.
                            This covers the instances where Niantic reuse shards within an event
                            i.e. 65 shards for a 78 shard anomaly!
                        */
                        shardEntries.push({
                            id: shardId,
                        });

                        destPortalId = getOrCreatePortalForSite(
                            site,
                            destPortalKey,
                            historyItem.destinationPortalInfo
                        );

                        addToPortalHistory(site, destPortalId, shardId, historyItem, historyItem.destinationCapturerTeam);
                        mostRecentShardPortalKey = destPortalKey;
                        break;
                    case HISTORY_REASONS.NO_MOVE:
                        originPortalId = getOrCreatePortalForSite(
                            site,
                            mostRecentShardPortalKey,
                            historyItem.originPortalInfo,
                        );

                        addToPortalHistory(site, originPortalId, shardId, historyItem);
                        break;
                    case HISTORY_REASONS.LINK:
                    case HISTORY_REASONS.JUMP:
                        if (!originPortalKey || !destPortalKey) {
                            console.errror(`Warning: Missing portal info for LINK/JUMP history item in shardId ${shardId}.`);
                            continue;
                        }
                        originPortalId = getOrCreatePortalForSite(
                            site,
                            originPortalKey,
                            historyItem.originPortalInfo,
                            historyItem.originCapturerTeam
                        );
                        destPortalId = getOrCreatePortalForSite(
                            site,
                            destPortalKey,
                            historyItem.destinationPortalInfo,
                            historyItem.destinationCapturerTeam
                        );

                        const originPortalObj = site.portals.find(portal => portal.id === originPortalId);
                        const destPortalObj = site.portals.find(portal => portal.id === destPortalId);
                        if (!originPortalObj || !destPortalObj) {
                            console.error(`Error: Could not find portal objects for IDs ${originPortalId} or ${destPortalId} in site ${site.name}.`);
                            continue;
                        }

                        addToPortalHistory(site, originPortalId, shardId, historyItem, historyItem.linkCreatorTeam);
                        addToPortalHistory(site, destPortalId, shardId, historyItem, historyItem.linkCreatorTeam);

                        const distance = haversineDistance(
                            { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                            { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                        );
                        // console.debug(`Calculated distance between portals ${originPortalId} (${originPortalObj.lat}, ${originPortalObj.lng}) and ${destPortalId} (${destPortalObj.lat}, ${destPortalObj.lng}):  ${distance} meters.`);

                        let points = 0;
                        if (allowFurtherPoints) {
                            const linkRule = getLinkRule(linkScoringRules.get(site.eventType), distance);
                            if (linkRule) {
                                points = linkRule.jumpPoints + linkRule.linkLengthPoints;
                                allowFurtherPoints = linkRule.allowFurtherPoints;
                            }
                        }

                        if (!shardEntries[shardEntries.length - 1].links) {
                            shardEntries[shardEntries.length - 1].links = [];
                        }
                        const roundedDistance = Math.round(distance * 100) / 100;
                        shardEntries[shardEntries.length - 1].links.push({
                            origin: originPortalId,
                            dest: destPortalId,
                            link: Math.floor(historyItem.linkCreationTimeMs / 1000),
                            move: Math.floor(historyItem.moveTimeMs / 1000),
                            distance: roundedDistance,
                            points,
                            linkTeam: getAbbreviatedTeam(historyItem.linkCreatorTeam),
                        });

                        if (points > 0) {
                            const moveTimeMs = new Date(parseInt(historyItem.moveTimeMs)).toLocaleString(
                                [],
                                {
                                    timeZone: site.timezone,
                                }
                            );

                            // console.debug(
                            //     `${artifact.id}: Adding ${historyItem.linkCreatorTeam} link from ${originPortalId} to ${destPortalId} (${roundedDistance}m) at ${moveTimeMs} with points: ${points}`
                            // );

                            switch (historyItem.linkCreatorTeam) {
                                case "RESISTANCE":
                                    site.linkScores.RES += points;
                                    break;
                                case "MACHINA":
                                    site.linkScores.MAC += points;
                                    break;
                                case "ENLIGHTENED":
                                    site.linkScores.ENL += points;
                                    break;
                                default:
                                    site.linkScores.NEU += points;
                            }
                        }

                        mostRecentShardPortalKey = destPortalKey;
                        break;
                    case HISTORY_REASONS.DESPAWN:
                        originPortalId = getOrCreatePortalForSite(
                            site,
                            originPortalKey,
                            historyItem.originPortalInfo,
                        );
                        addToPortalHistory(site, originPortalId, shardId, historyItem, historyItem.originCapturerTeam);
                        break;
                    default:
                        console.warn(`Unknown reason for ${shardId}: ${historyItem.reason}`);
                }
            }
            site.movingShards.push(...shardEntries.filter(shard => shard.links && shard.links.length > 0));
        }
        const linkCount = site.movingShards.reduce((totalLinks, shard) => totalLinks + shard.links?.length, 0);
        const nonMovingShards = site.portals.flatMap(p => p.shardHistory || []).filter(s => s.history && s.history.length >= 2 && s.history[0].reason === 'spawn' && s.history[s.history.length - 1].reason === 'despawn' && s.history.slice(1, -1).every(entry => entry.reason === 'no move')).length;
        const totalShards = nonMovingShards + site.movingShards.length;
        console.debug(
            `Site ${site.name} has ${totalShards} shards (${nonMovingShards}/${site.movingShards.length}), ${site.portals.length} portals and ${linkCount} links.`
        );
    }
    console.debug(calculateJsonSizeReduction(name, json, sites));
    return {
        name,
        sites,
    };
}

const portalLookupByOriginalKey = Symbol('portalLookupByOriginalKey');
const portalIdCounter = Symbol('portalIdCounter');

function haversineDistance(coords1, coords2) {
    // Mean Earth Radius in meters
    const R = 6371000;
    const TO_RADIANS = Math.PI / 180;

    const lat1 = coords1.latitude;
    const lon1 = coords1.longitude;
    const lat2 = coords2.latitude;
    const lon2 = coords2.longitude;

    // Convert degrees to radians
    const dLat = (lat2 - lat1) * TO_RADIANS;
    const dLon = (lon2 - lon1) * TO_RADIANS;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * TO_RADIANS) * Math.cos(lat2 * TO_RADIANS) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c;

    return distance;
}

function createSite(siteDetails) {
    // console.debug(`Creating new site ${siteDetails.id} for ${siteDetails.city || "Unknown"} (timezone ${siteDetails.timezone || "UTC"}), ${siteDetails.eventType} `);

    let shardIdPrefix;
    if (siteDetails.fragment) {
        const fullShardId = siteDetails.fragment[0].id
        shardIdPrefix = fullShardId.slice(0, fullShardId.lastIndexOf('_') + 1);
    }

    return {
        id: siteDetails.id,
        name: siteDetails.city || "Unknown",
        timezone: siteDetails.timezone || "UTC",
        eventType: siteDetails.eventType,
        portals: [],
        movingShards: [],
        linkScores: {
            RES: 0,
            ENL: 0,
            MAC: 0,
            NEU: 0,
        },
        shardIdPrefix, // To store the common prefix for shards in this site

        // Internal fields for portal ID management within this site
        [portalLookupByOriginalKey]: {},
        [portalIdCounter]: 1,
    };
}

function getShardSingularCity(name, index) {
    let lookupId = index;
    if (name == "_theta_2025_05_31_shard_singular") lookupId += 16;
    if (name == "_theta_2025_06_07_shard_singular") lookupId += 32;
    return shard_singulars[lookupId];
}

function getOrCreatePortalForSite(site, originalPortalKey, portalInfo) {
    if (!Object.hasOwn(site[portalLookupByOriginalKey], originalPortalKey)) {
        const portalId = site[portalIdCounter];
        site[portalLookupByOriginalKey][originalPortalKey] = portalId;

        site.portals.push({
            id: portalId,
            title: portalInfo.title,
            lat: portalInfo.latE6 / 1e6,
            lng: portalInfo.lngE6 / 1e6,
        });
        site[portalIdCounter]++;
    }
    return site[portalLookupByOriginalKey][originalPortalKey];
}

function addToPortalHistory(site, portalId, shardId, historyItem, capturerTeam) {
    let portal = site.portals.find(portal => portal.id === portalId);
    if (!portal.shardHistory) {
        portal.shardHistory = [];
    }
    let shardHistoryItem = portal.shardHistory.find(shard => shard.id === shardId);
    if (!shardHistoryItem) {
        shardHistoryItem = {
            id: shardId,
            history: [],
        };
        portal.shardHistory.push(shardHistoryItem);
    }

    shardHistoryItem.history.push({
        time: Math.floor(historyItem.moveTimeMs / 1000),
        reason: historyItem.reason,
        team: capturerTeam && getAbbreviatedTeam(capturerTeam),
    });
}

function getLinkRule(rules, distance) {
    for (const rule of rules.rules) {
        if (distance >= rule.minDistance && distance < rule.maxDistance) {
            return rule;
        }
    }
    return null;
}

function calculateJsonSizeReduction(name, originalJson, shardEventDataJson) {
    const originalSize = JSON.stringify(originalJson).length;
    const plottableSize = JSON.stringify(Array.from(shardEventDataJson.values())).length;
    return `${name} - original JSON size: ${originalSize} bytes, converted Shard Series Data size: ${plottableSize} bytes, Reduction: ${(
        (1 - plottableSize / originalSize) *
        100
    ).toFixed(2)}%`;
}
