import { HISTORY_REASONS, SHARD_EVENT_TYPE, SITE_AGGREGATION_DISTANCE, getAbbreviatedTeam } from "../constants.js";
import { calculateCentroid, getCoordsForFragment, getFragmentSpawnTimeMs } from "./shard-data-helpers.js";
import { haversineDistance } from "../shared/math-helpers.js";
import { isWithin24Hours } from "../shared/date-helpers.js";

const portalLookupByOriginalKey = Symbol('portalLookupByOriginalKey');
const portalIdCounter = Symbol('portalIdCounter');
const moved = Symbol('moved');

const basicRules = {
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
};

export const linkScoringRules = new Map()
    .set(SHARD_EVENT_TYPE.ANOMALY, basicRules)
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
    .set(SHARD_EVENT_TYPE.STORM, {
        rules: [
            {
                description:
                    "10 Season Points for a single jump over a Link longer than 10 km (ten kilometers). No further points will be given for subsequent jumps by that Shard.",
                jumpPoints: 0,
                minDistance: 10000,
                maxDistance: Infinity,
                linkLengthPoints: 10,
                allowFurtherPoints: false,
            },
            {
                description: "5 Season Points for each jump over a Link between 1km and 5km in length.",
                jumpPoints: 0,
                minDistance: 1000,
                maxDistance: 5000,
                linkLengthPoints: 5,
                allowFurtherPoints: true,
            },
        ],
    })
    .set(SHARD_EVENT_TYPE.SINGLE_SHARD, basicRules)
    .set(SHARD_EVENT_TYPE.MULTIPLE_SHARDS, basicRules)
    .set(SHARD_EVENT_TYPE.UNKNOWN, basicRules);


export function processSeriesData(seriesDataPackage) {
    const { geocode, rawData } = seriesDataPackage;
    const sitesGeocode = geocode.sites;
    const { shardJumpTimes } = rawData;

    const allSites = {};
    sitesGeocode.forEach(siteGeocode => {
        allSites[siteGeocode.id] = createSite(siteGeocode);
    });

    const siteFragmentsMap = new Map();
    for (const sjt of shardJumpTimes) {
        const artifacts = sjt.artifact.filter((d) => d.fragment);
        artifacts.sort((a, b) => a.name.localeCompare(b.name));

        for (const artifact of artifacts) {
            const sortedFragments = artifact.fragment.sort((a, b) => a.id.localeCompare(b.id));
            const siteOfFirstFragment = findSiteForFragment(sortedFragments[0], sitesGeocode);

            const addFragmentsToSite = (fragments, siteId) => {
                if (!siteFragmentsMap.has(siteId)) {
                    siteFragmentsMap.set(siteId, []);
                }
                siteFragmentsMap.get(siteId).push(...fragments);
            };

            if (siteOfFirstFragment.type.multipleShards) {
                addFragmentsToSite(sortedFragments, siteOfFirstFragment.id);
            } else {
                for (const fragment of sortedFragments) {
                    const fragmentSite = findSiteForFragment(fragment, sitesGeocode);
                    addFragmentsToSite([fragment], fragmentSite.id);
                }
            }
        }
    }

    const processedSites = Array.from(siteFragmentsMap.entries()).map(([siteId, fragments]) => {
        const processedSite = processSite(allSites[siteId], fragments);
        return [siteId, processedSite];
    });

    const seriesData = Object.fromEntries(processedSites);
    console.log(`\t${Object.keys(seriesData).length} sites processed.`);
    return seriesData;
}

// A function to convert Niantic's shard jump times json into a more usable format for display on a map.
export function processSite(site, fragments) {
    site.centroid = calculateCentroid(fragments);
    for (const fragment of fragments.sort((a, b) => a.id.localeCompare(b.id))) {
        const shardId = parseInt(fragment.id.includes('_') ? fragment.id.slice(fragment.id.lastIndexOf('_') + 1) : fragment.id, 10);

        let mostRecentShardPortalKey;
        let shard;
        let allowFurtherPoints = true;
        for (const historyItem of fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))) {
            const originPortalKey =
                historyItem.originPortalInfo &&
                `${historyItem.originPortalInfo.latE6}_${historyItem.originPortalInfo.lngE6}`;
            const destPortalKey =
                historyItem.destinationPortalInfo &&
                `${historyItem.destinationPortalInfo.latE6}_${historyItem.destinationPortalInfo.lngE6}`;
            const moveTime = Math.floor(historyItem.moveTimeMs / 1000);

            let shardHistoryItem = {
                reason: historyItem.reason,
                moveTime,
            }

            let originPortalId, destPortalId;
            switch (historyItem.reason) {
                case HISTORY_REASONS.SPAWN: {
                    /*
                        Create a new shard entry if a spawn entry is found.
                        This covers the instances where Niantic reuse shards within an event
                        i.e. 65 shards for a 78 shard anomaly!
                    */
                    destPortalId = getOrCreatePortalForSite(
                        site,
                        destPortalKey,
                        historyItem.destinationPortalInfo
                    );

                    if (shard) {
                        shard[moved] ? site.counters.shards.moving++ : site.counters.shards.nonMoving++;
                        site.shards.push(shard);
                    }

                    shard = {
                        id: shardId,
                        history: [],
                        [moved]: false,
                    };

                    shard.history.push({
                        ...shardHistoryItem,
                        portalId: destPortalId,
                        team: historyItem.destinationCapturerTeam && getAbbreviatedTeam(historyItem.destinationCapturerTeam),
                    });

                    mostRecentShardPortalKey = destPortalKey;
                    break;
                }
                case HISTORY_REASONS.NO_MOVE: {
                    originPortalId = getOrCreatePortalForSite(
                        site,
                        mostRecentShardPortalKey,
                        historyItem.originPortalInfo,
                    );

                    shard.history.push({
                        ...shardHistoryItem,
                        portalId: originPortalId
                    });
                    break;
                }
                case HISTORY_REASONS.LINK:
                case HISTORY_REASONS.JUMP: {
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

                    const originPortalObj = site.portals[originPortalId];
                    const destPortalObj = site.portals[destPortalId];
                    if (!originPortalObj || !destPortalObj) {
                        console.error(`Error: Could not find portal objects for IDs ${originPortalId} or ${destPortalId} in site ${site.name}.`);
                        continue;
                    }

                    const distance = haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    );

                    let points = 0;
                    if (allowFurtherPoints) {
                        const linkRule = getLinkRule(linkScoringRules.get(SHARD_EVENT_TYPE[site.geocode.type]), distance);
                        if (linkRule) {
                            points = linkRule.jumpPoints + linkRule.linkLengthPoints;
                            allowFurtherPoints = linkRule.allowFurtherPoints;
                        }
                    }

                    shard.history.push({
                        ...shardHistoryItem,
                        portalId: originPortalId,
                        dest: destPortalId,
                        team: historyItem.linkCreatorTeam && getAbbreviatedTeam(historyItem.linkCreatorTeam),
                    });
                    shard[moved] = true;

                    const linkPathKey = [originPortalId, destPortalId].sort().join('-');
                    const linkTime = Math.floor(historyItem.linkCreationTimeMs / 1000);
                    const newLink = {
                        linkTime,
                        team: historyItem.linkCreatorTeam && getAbbreviatedTeam(historyItem.linkCreatorTeam),
                        jumps: [{
                            origin: originPortalId,
                            dest: destPortalId,
                            shardId,
                            moveTime,
                            points,
                        }]
                    };

                    const existingPath = site.linkPaths[linkPathKey];
                    if (existingPath) {
                        const existingLink = existingPath.links.find(link => link.linkTime === linkTime);
                        if (existingLink) {
                            existingLink.jumps.push({
                                origin: originPortalId,
                                dest: destPortalId,
                                shardId,
                                moveTime,
                                points,
                            });
                        } else {
                            site.counters.links++;

                            existingPath.links.push(newLink);
                        }
                    } else {
                        site.counters.links++;

                        site.linkPaths[linkPathKey] = {
                            links: [newLink],
                            distance,
                        };
                    }

                    if (points > 0) {
                        switch (historyItem.linkCreatorTeam) {
                            case "RESISTANCE":
                                site.scores.RES += points;
                                break;
                            case "ENLIGHTENED":
                                site.scores.ENL += points;
                                break;
                            case "MACHINA":
                                site.scores.MAC += points;
                                break;
                        }
                    }

                    mostRecentShardPortalKey = destPortalKey;
                    break;
                }
                case HISTORY_REASONS.DESPAWN: {
                    originPortalId = getOrCreatePortalForSite(
                        site,
                        originPortalKey,
                        historyItem.originPortalInfo,
                    );
                    shard.history.push({
                        ...shardHistoryItem,
                        portalId: originPortalId,
                        team: historyItem.originCapturerTeam && getAbbreviatedTeam(historyItem.originCapturerTeam)
                    });
                    break;
                }
                default:
                    console.warn(`Unknown reason for ${shardId}: ${historyItem.reason}`);
            }
        }

        shard[moved] ? site.counters.shards.moving++ : site.counters.shards.nonMoving++;
        site.shards.push(shard);
    }

    site.counters.portals = site.portals.size;
    site.counters.paths = site.linkPaths.size;
    return site;
}

function findSiteForFragment(fragment, sitesGeocode) {
    const fragmentCoords = getCoordsForFragment(fragment);

    let matchedSite = sitesGeocode.find(site => {
        const siteCoords = {
            latitude: site.lat,
            longitude: site.lng,
        };
        const distance = haversineDistance(fragmentCoords, siteCoords);
        const siteDate = new Date(site.date).getTime();
        const matchingDate = isWithin24Hours(getFragmentSpawnTimeMs(fragment), siteDate);

        return (distance < SITE_AGGREGATION_DISTANCE && matchingDate);
    });
    return matchedSite;
}

function createSite(siteGeocode) {
    return {
        geocode: {
            ...siteGeocode
        },
        portals: {},
        shards: [],
        linkPaths: {},
        scores: {
            RES: 0,
            ENL: 0,
            MAC: 0,
        },
        counters: {
            portals: 0,
            shards: {
                moving: 0,
                nonMoving: 0,
            },
            links: 0,
            paths: 0,
        },
        // Internal fields for portal ID management within this site
        [portalLookupByOriginalKey]: {},
        [portalIdCounter]: 1,
    };
}

function getOrCreatePortalForSite(site, originalPortalKey, portalInfo) {
    if (!Object.hasOwn(site[portalLookupByOriginalKey], originalPortalKey)) {
        const portalId = site[portalIdCounter];
        site[portalLookupByOriginalKey][originalPortalKey] = portalId;

        site.portals[portalId] = {
            title: portalInfo.title,
            lat: portalInfo.latE6 / 1e6,
            lng: portalInfo.lngE6 / 1e6,
        };
        site[portalIdCounter]++;
    }
    return site[portalLookupByOriginalKey][originalPortalKey];
}

function getLinkRule(rules, distance) {
    for (const rule of rules.rules) {
        if (distance >= rule.minDistance && distance < rule.maxDistance) {
            return rule;
        }
    }
    return null;
}
