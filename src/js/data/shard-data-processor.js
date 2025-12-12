import { HISTORY_REASONS, SHARD_EVENT_TYPE, SITE_AGGREGATION_DISTANCE, getAbbreviatedTeam } from "../constants.js";
import { calculateCentroid, getCoordsForFragment, getFragmentSpawnTimeMs } from "./shard-data-helpers.js";
import { haversineDistance } from "../shared/math-helpers.js";
import { createWaveDate, isWithin24Hours } from "../shared/date-helpers.js";

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
    const { config, geocode, rawData } = seriesDataPackage;
    const sitesGeocode = geocode.sites;
    const { shardJumpTimes } = rawData;

    const allSites = {};
    sitesGeocode.forEach(siteGeocode => {
        allSites[siteGeocode.id] = {
            geocode: {
                ...siteGeocode
            },
            portals: {},
            // Internal fields for portal ID management within this site
            [portalLookupByOriginalKey]: {},
            [portalIdCounter]: 1,
        };
    });

    const siteFragmentsMap = new Map();
    for (const sjt of shardJumpTimes) {
        const artifacts = sjt.artifact.filter((d) => d.fragment);
        artifacts.sort((a, b) => a.name.localeCompare(b.name));

        for (const artifact of artifacts) {
            const sortedFragments = artifact.fragment.sort((a, b) => a.id.localeCompare(b.id));

            const addFragmentToSite = (fragment, siteId) => {
                if (!siteFragmentsMap.has(siteId)) {
                    siteFragmentsMap.set(siteId, []);
                }
                /*
                    Create new fragment shard entries if multiple spawn entries are found for a fragment.
                    This covers the instances where Niantic reuse shards within an event
                    i.e. 65 shards for a 78 shard anomaly!
                */
                const spawnEvents = fragment.history.filter(h => h.reason === HISTORY_REASONS.SPAWN).length;
                if (spawnEvents > 1) {
                    const fragments = [];
                    let splitFragment;
                    for (const historyItem of fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))) {
                        if (historyItem.reason === HISTORY_REASONS.SPAWN) {
                            splitFragment = {
                                id: fragment.id,
                                history: [],
                            };
                            fragments.push(splitFragment);
                        }
                        splitFragment.history.push(historyItem);
                    }
                    siteFragmentsMap.get(siteId).push(...fragments);
                } else {
                    siteFragmentsMap.get(siteId).push(fragment);
                }
            };

            for (const fragment of sortedFragments) {
                const fragmentSite = findSiteForFragment(fragment, sitesGeocode);
                addFragmentToSite(fragment, fragmentSite.id);
            }
        }
    }

    const processedSites = Array.from(siteFragmentsMap.entries()).map(([siteId, fragments]) =>
        processSite(allSites[siteId], fragments, config)
    );

    validateSites(processedSites, config);

    const seriesData = Object.fromEntries(processedSites.map(site => [site.geocode.id, site]));
    console.log(`\t${Object.keys(seriesData).length} sites processed.`);
    return seriesData;
}

export function processSite(site, fragments, seriesConfig) {
    site.centroid = calculateCentroid(fragments);
    site.portals = getPortalsFromFragments(site, fragments);

    const siteEventType = site.geocode.type;
    const seriesEventConfig = seriesConfig?.eventTypes?.[siteEventType];

    site.fullEvent = processFragments(fragments, site[portalLookupByOriginalKey], site.portals, siteEventType);

    if (seriesEventConfig && seriesEventConfig.shards.waves && seriesEventConfig.shards.waves.length > 1) {
        site.waves = [];

        seriesEventConfig.shards.waves.forEach((wave) => {
            const waveStart = createWaveDate(site.geocode.date, site.geocode.timezone, wave.startTime)
            const waveEnd = createWaveDate(site.geocode.date, site.geocode.timezone, wave.endTime);

            const waveFragments = fragments.filter(fragment => {
                const spawnTime = getFragmentSpawnTimeMs(fragment);
                return spawnTime >= waveStart.getTime() && spawnTime <= waveEnd.getTime();
            });
            site.waves.push(processFragments(waveFragments, site[portalLookupByOriginalKey], site.portals, siteEventType));
        });
    }
    return site;
}

function processFragments(fragments, portalLookup, sitePortals, eventType) {
    const viewData = {
        shards: [],
        linkPaths: {},
        scores: {
            RES: 0,
            ENL: 0,
            MAC: 0,
        },
        counters: {
            shards: {
                moving: 0,
                nonMoving: 0,
            },
            links: 0,
            paths: 0,
        },
    };

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
            const moveTime = historyItem.moveTimeMs;

            let originPortalId = originPortalKey && portalLookup[originPortalKey];
            let destPortalId = destPortalKey && portalLookup[destPortalKey];

            let shardHistoryItem = {
                reason: historyItem.reason,
                moveTime,
            }

            switch (historyItem.reason) {
                case HISTORY_REASONS.SPAWN: {
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
                    originPortalId = portalLookup[mostRecentShardPortalKey];
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

                    const originPortalObj = sitePortals[originPortalId];
                    const destPortalObj = sitePortals[destPortalId];
                    if (!originPortalObj || !destPortalObj) {
                        console.error(`Error: Could not find portal objects for IDs ${originPortalId} or ${destPortalId}.`);
                        continue;
                    }

                    const distance = haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    );

                    let points = 0;
                    if (allowFurtherPoints) {
                        const linkRule = getLinkRule(linkScoringRules.get(SHARD_EVENT_TYPE[eventType]), distance);
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
                    const linkTime = historyItem.linkCreationTimeMs;
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

                    const existingPath = viewData.linkPaths[linkPathKey];
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
                            viewData.counters.links++;

                            existingPath.links.push(newLink);
                        }
                    } else {
                        viewData.counters.links++;

                        viewData.linkPaths[linkPathKey] = {
                            links: [newLink],
                            distance,
                        };
                    }

                    if (points > 0) {
                        switch (historyItem.linkCreatorTeam) {
                            case "RESISTANCE":
                                viewData.scores.RES += points;
                                break;
                            case "ENLIGHTENED":
                                viewData.scores.ENL += points;
                                break;
                            case "MACHINA":
                                viewData.scores.MAC += points;
                                break;
                        }
                    }

                    mostRecentShardPortalKey = destPortalKey;
                    break;
                }
                case HISTORY_REASONS.DESPAWN: {
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

        shard[moved] ? viewData.counters.shards.moving++ : viewData.counters.shards.nonMoving++;
        viewData.shards.push(shard);
    }

    viewData.counters.paths = viewData.linkPaths.size;
    return viewData;
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

function getPortalsFromFragments(site, fragments) {
    const portals = {}
    for (const fragment of fragments.sort((a, b) => a.id.localeCompare(b.id))) {
        for (const historyItem of fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))) {
            const originPortalKey =
                historyItem.originPortalInfo &&
                `${historyItem.originPortalInfo.latE6}_${historyItem.originPortalInfo.lngE6}`;
            const destPortalKey =
                historyItem.destinationPortalInfo &&
                `${historyItem.destinationPortalInfo.latE6}_${historyItem.destinationPortalInfo.lngE6}`;

            if (originPortalKey) {
                const originPortal = createPortalForSite(site, originPortalKey, historyItem.originPortalInfo);
                if (originPortal) {
                    portals[originPortal.id] = originPortal.obj;
                }
            }
            if (destPortalKey) {
                const destPortal = createPortalForSite(site, destPortalKey, historyItem.destinationPortalInfo);
                if (destPortal) {
                    portals[destPortal.id] = destPortal.obj;
                }
            }
        }
    }
    return portals;
}

function createPortalForSite(site, originalPortalKey, portalInfo) {
    let newPortal = null;
    if (!Object.hasOwn(site[portalLookupByOriginalKey], originalPortalKey)) {
        const portalId = site[portalIdCounter];
        site[portalLookupByOriginalKey][originalPortalKey] = portalId;

        newPortal = {
            id: portalId,
            obj: {
                title: portalInfo.title,
                lat: portalInfo.latE6 / 1e6,
                lng: portalInfo.lngE6 / 1e6,
            }
        };
        site[portalIdCounter]++;
    }
    return newPortal;
}

function getLinkRule(rules, distance) {
    for (const rule of rules.rules) {
        if (distance >= rule.minDistance && distance < rule.maxDistance) {
            return rule;
        }
    }
    return null;
}

function validateSites(processedSites, seriesConfig) {
    const seriesValidation = {
        eventTypes: {},
    };

    for (const [eventType, eventConfig] of Object.entries(seriesConfig.eventTypes)) {
        const totalShards = eventConfig.shards?.waves.reduce((sum, wave) => sum + (wave.count || 0), 0) || 0;

        // Assuming 2 factions (RES/ENL) for target counts.
        const totalTargets = eventConfig.targets?.waves.reduce((sum, wave) => sum + ((wave.countPerFaction || 0) * 2), 0) || 0;

        if (totalShards > 0 || totalTargets > 0) {
            seriesValidation.eventTypes[eventType] = {
                totalShards,
                totalTargets,
            };
        }
    }

    for (const site of processedSites) {
        const siteType = site.geocode.type;
        const { totalShards, totalTargets } = seriesValidation.eventTypes[siteType];
        if (site.fullEvent.shards.length !== totalShards) {
            console.warn(`\t⚠️ Site ${site.geocode.id}: expected ${totalShards} shards but only ${site.fullEvent.shards.length} found.`)
        }
        if (site.fullEvent.targets) {
            if (site.fullEvent.targets.length !== totalTargets) {
                console.warn(`\t⚠️ Site ${site.geocode.id}: expected ${totalTargets} targets but only ${site.fullEvent.targets.length} found.`)
            }
        }
    }
}