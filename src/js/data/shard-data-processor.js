import { DateTime } from 'luxon';
import { HISTORY_REASONS, SITE_AGGREGATION_DISTANCE, getAbbreviatedTeam } from "../constants.js";
import { calculateCentroid, getCoordsForFragment, getFragmentSpawnTimeMs } from "./shard-data-helpers.js";
import { haversineDistance } from "../shared/math-helpers.js";
import { formatEpochToLocalTime, isWithin24Hours } from "../shared/date-helpers.js";

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
    .set("ANOMALY", basicRules)
    .set("SKIRMISH", {
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
    .set("SINGULAR", {
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
    .set("STORM", {
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
    .set("INVESTIGATION", {
        rules: [
            {
                description: "5 CI for Links between 200 and 500 meters",
                jumpPoints: 0,
                minDistance: 200,
                maxDistance: 500,
                linkLengthPoints: 5,
                allowFurtherPoints: true,
            },
            {
                description: "10 CI for Links less than 200 meters",
                jumpPoints: 0,
                minDistance: 0,
                maxDistance: 200,
                linkLengthPoints: 10,
                allowFurtherPoints: true,
            },
        ],
    })
    .set("SINGLE_SHARD", basicRules)
    .set("MULTIPLE_SHARDS", basicRules)
    .set("UNKNOWN", basicRules);


export function processSeriesData(seriesDataPackage) {
    const { config, geocode, blueprints, rawData } = seriesDataPackage;
    const sitesGeocode = geocode.sites;
    const { shardJumpTimes } = rawData;

    console.log(`ℹ️ Processing series ${config.name}:`);

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
        processSite(allSites[siteId], fragments, config, blueprints)
    );

    const seriesData = Object.fromEntries(processedSites.map(site => [site.geocode.id, site]));
    console.log(`ℹ️ ${Object.keys(seriesData).length} sites processed.\n`);
    return seriesData;
}

export function processSite(site, fragments, seriesConfig, blueprints) {
    site.centroid = calculateCentroid(fragments);
    site.portals = getPortalsFromFragments(site, fragments);

    const siteBrandId = site.geocode.brand;
    const shardComponents = seriesConfig.shardComponents || [];
    const seriesEventConfig = shardComponents.find(et => et.brand === siteBrandId);

    // Find site-specific config for overrides
    let siteConfig = null;
    seriesEventConfig?.schedule?.forEach(sched => {
        const found = sched.sites?.find(s => s.name === site.geocode.name);
        if (found) siteConfig = found;
    });

    // Resolve blueprints
    const shardMechanic = seriesEventConfig ? blueprints.shardMechanics[seriesEventConfig.shardMechanics] : null;

    site.fullEvent = processFragments({
        fragments,
        portalLookup: site[portalLookupByOriginalKey],
        sitePortals: site.portals,
        brandId: siteBrandId,
        geocode: site.geocode,
        fullEvent: true,
    });

    if (shardMechanic && shardMechanic.waves && shardMechanic.waves.length > 1) {
        site.waves = [];

        const isoPart = site.geocode.date.split('[')[0];
        const baseline = DateTime.fromISO(isoPart, { zone: site.geocode.timezone });

        shardMechanic.waves.forEach((wave, index) => {
            const waveStart = baseline.plus({ minutes: wave.startOffset }).toJSDate();
            // endOffset is inclusive of the minute, so we look until the start of the next minute
            const waveEnd = baseline.plus({ minutes: wave.endOffset + 1 }).toJSDate();

            const waveFragments = fragments.filter(fragment => {
                const spawnTime = getFragmentSpawnTimeMs(fragment);
                return spawnTime >= waveStart.getTime() && spawnTime < waveEnd.getTime();
            });

            // Apply site-specific wave quantity override if provided
            const expectedQuantity = (siteConfig?.shardCounts && siteConfig.shardCounts[index] !== undefined)
                ? siteConfig.shardCounts[index]
                : wave.quantity;

            const waveViewData = processFragments({
                fragments: waveFragments,
                portalLookup: site[portalLookupByOriginalKey],
                sitePortals: site.portals,
                brandId: siteBrandId,
                geocode: site.geocode,
                fullEvent: false,
                expectedQuantity: expectedQuantity,
            });
            site.waves.push(waveViewData);
        });
    }
    return site;
}

function processFragments({ fragments, portalLookup, sitePortals, brandId, geocode, fullEvent }) {
    const siteName = geocode.name;
    const viewData = {
        shards: [],
        shardPaths: {},
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
                case HISTORY_REASONS.JUMP: {
                    if (historyItem.linkCreationTimeMs) {
                        console.log(`⚠️  Shard ${shardId} (${siteName}) should random jump, but has a link time. Could this be a link jump instead?`);
                        continue;
                    }

                    if (!originPortalKey || !destPortalKey) {
                        console.log(`⚠️  Missing portal info for JUMP history item in shardId ${shardId} (${siteName}).`);
                        continue;
                    }

                    const originPortalObj = sitePortals[originPortalId];
                    const destPortalObj = sitePortals[destPortalId];
                    if (!originPortalObj || !destPortalObj) {
                        console.log(`❌ Could not find portal objects for IDs ${originPortalId} or ${destPortalId} at site ${siteName}.`);
                        continue;
                    }

                    const distance = haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    );

                    shard.history.push({
                        ...shardHistoryItem,
                        portalId: originPortalId,
                        dest: destPortalId,
                    });
                    shard[moved] = true;

                    const pathKey = [originPortalId, destPortalId].sort().join('-');
                    const newJump = {
                        origin: originPortalId,
                        dest: destPortalId,
                        shardId,
                        moveTime,
                    };

                    const existingPath = viewData.shardPaths[pathKey];
                    if (existingPath) {
                        if (existingPath.jumps) {
                            existingPath.jumps.push(newJump);
                        } else {
                            existingPath.jumps = [newJump];
                        }
                    } else {
                        viewData.shardPaths[pathKey] = {
                            jumps: [newJump],
                            distance,
                        };
                    }

                    mostRecentShardPortalKey = destPortalKey;
                    break;
                }
                case HISTORY_REASONS.LINK: {
                    if (!historyItem.linkCreationTimeMs) {
                        console.log(`⚠️  Missing link creation time for shard ${shardId} (${siteName}). Could this be a random jump instead?`);
                        continue;
                    }

                    if (!originPortalKey || !destPortalKey) {
                        console.log(`⚠️  Missing portal info for LINK history item in shardId ${shardId} (${siteName}).`);
                        continue;
                    }
                    if (historyItem.linkCreatorTeam !== historyItem.originPortalInfo.team || historyItem.linkCreatorTeam !== historyItem.destinationPortalInfo.team) {
                        if (fullEvent) {
                            const localTime = formatEpochToLocalTime(moveTime, geocode.timezone);
                            const teamInfo = {
                                origin: getAbbreviatedTeam(historyItem.originPortalInfo.team),
                                link: getAbbreviatedTeam(historyItem.linkCreatorTeam),
                                dest: getAbbreviatedTeam(historyItem.destinationPortalInfo.team),
                            }
                            console.log(
                                `⚠️ Shard ${shardId} (${siteName}) alignment mismatch at ${localTime}:`, teamInfo);
                        }
                    }


                    const originPortalObj = sitePortals[originPortalId];
                    const destPortalObj = sitePortals[destPortalId];
                    if (!originPortalObj || !destPortalObj) {
                        console.error(`❌ Could not find portal objects for IDs ${originPortalId} or ${destPortalId} at site ${siteName}.`);
                        continue;
                    }

                    const distance = haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    );

                    let points = 0;
                    if (allowFurtherPoints) {
                        const brandRules = linkScoringRules.get(brandId);
                        const linkRule = getLinkRule(brandRules, distance);
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

                    const pathKey = [originPortalId, destPortalId].sort().join('-');
                    const linkTime = historyItem.linkCreationTimeMs;
                    const newLink = {
                        linkTime,
                        team: historyItem.linkCreatorTeam && getAbbreviatedTeam(historyItem.linkCreatorTeam),
                        moves: [{
                            origin: originPortalId,
                            dest: destPortalId,
                            shardId,
                            moveTime,
                            points,
                        }]
                    };

                    const existingPath = viewData.shardPaths[pathKey];
                    if (existingPath) {
                        const existingLink = existingPath.links.find(link => link.linkTime === linkTime);
                        if (existingLink) {
                            existingLink.moves.push({
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

                        viewData.shardPaths[pathKey] = {
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
                    console.log(`⚠️ Unknown reason for ${shardId}: ${historyItem.reason}`);
            }
        }

        shard[moved] ? viewData.counters.shards.moving++ : viewData.counters.shards.nonMoving++;
        viewData.shards.push(shard);
    }

    viewData.counters.paths = viewData.shardPaths.size;
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
        const isoPart = site.date.split('[')[0];
        const siteDate = DateTime.fromISO(isoPart, { zone: site.timezone }).toMillis();
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
    if (!rules || !rules.rules) {
        return null;
    }
    for (const rule of rules.rules) {
        if (distance >= rule.minDistance && distance < rule.maxDistance) {
            return rule;
        }
    }
    return null;
}
