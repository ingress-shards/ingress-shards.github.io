import { DateTime } from 'luxon';
import { HISTORY_REASONS, SITE_AGGREGATION_DISTANCE, getAbbreviatedTeam } from "../constants.js";
import { calculateCentroid, getCoordsForFragment, getFragmentSpawnTimeMs, getPortalKey } from "./shard-data-helpers.js";
import { haversineDistance, roundToDecimalPlaces } from "../shared/math-helpers.js";
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
    const { config, geocode, blueprints, rawData, verbose = false } = seriesDataPackage;
    console.log(`ℹ️ Processing series ${config.name}:`);
    const sitesGeocode = geocode.sites;

    const { shardJumpTimes, ornamentedPortals, targetPortals } = rawData;
    console.log(`ℹ️ Processing ${shardJumpTimes.length} shard jump times files, ${ornamentedPortals?.length || 0} ornamented portals files and ${targetPortals?.length || 0} target portals files.`);

    const allObservedOrnamentedPortals = ornamentedPortals?.flatMap(exportObj =>
        exportObj.portals.map(p => ({ ...p, observedAt: DateTime.fromISO(exportObj.timestamp).toMillis() }))
    ) || [];

    const allObservedTargetPortalsByFaction = {
        RES: [],
        ENL: [],
    };

    targetPortals?.forEach(exportObj => {
        exportObj.artifact.forEach(artifact => {
            const abbreviatedTeam = artifact.id === 'targetres' ? 'RES' : artifact.id === 'targetenl' ? 'ENL' : null;
            if (!abbreviatedTeam) return;

            artifact.target.forEach(t => {
                allObservedTargetPortalsByFaction[abbreviatedTeam].push({
                    title: t.portalInfo.title,
                    lat: t.portalInfo.latE6 / 1e6,
                    lng: t.portalInfo.lngE6 / 1e6,
                    latE6: t.portalInfo.latE6,
                    lngE6: t.portalInfo.lngE6,
                    observedAt: t.observedAt,
                    faction: abbreviatedTeam,
                });
            });
        });
    });

    const ornamentsBySite = new Map();
    if (allObservedOrnamentedPortals.length > 0) {
        const loggedAmbiguous = new Set();
        for (const o of allObservedOrnamentedPortals) {
            const matches = sitesGeocode.filter(site => {
                const distance = roundToDecimalPlaces(haversineDistance(
                    { latitude: o.lat, longitude: o.lng },
                    { latitude: site.lat, longitude: site.lng }
                ), 2);
                return distance <= SITE_AGGREGATION_DISTANCE;
            });

            if (matches.length === 1) {
                const siteId = matches[0].id;
                if (!ornamentsBySite.has(siteId)) ornamentsBySite.set(siteId, []);
                ornamentsBySite.get(siteId).push(o);
            } else if (matches.length > 1) {
                const portalKey = `${o.title}@${o.lat},${o.lng}`;
                if (!loggedAmbiguous.has(portalKey)) {
                    console.error(`❌ Ornament "${o.title}" at ${o.lat}, ${o.lng} matches multiple sites: ${matches.map(m => m.name).join(', ')}. Skipping.`);
                    loggedAmbiguous.add(portalKey);
                }
            }
        }
    }

    const targetsBySite = new Map();
    Object.keys(allObservedTargetPortalsByFaction).forEach(faction => {
        for (const t of allObservedTargetPortalsByFaction[faction]) {
            const matches = sitesGeocode.filter(site => {
                const distance = roundToDecimalPlaces(haversineDistance(
                    { latitude: t.lat, longitude: t.lng },
                    { latitude: site.lat, longitude: site.lng }
                ), 2);
                return distance <= SITE_AGGREGATION_DISTANCE;
            });

            if (matches.length === 1) {
                const siteId = matches[0].id;
                if (!targetsBySite.has(siteId)) targetsBySite.set(siteId, []);
                targetsBySite.get(siteId).push(t);
            }
        }
    });


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

    const processedSites = Object.keys(allSites).map((siteId) => {
        const site = allSites[siteId];
        const fragments = siteFragmentsMap.get(siteId) || [];

        // Spatial Discovery:
        // Match ornaments/targets assigned to this site during pre-grouping
        const siteOrnamentedPortals = ornamentsBySite.get(siteId) || [];
        const siteTargetPortals = targetsBySite.get(siteId) || [];

        if (fragments.length === 0 && siteOrnamentedPortals.length === 0 && siteTargetPortals.length === 0) {
            return null;
        }

        return processSite(site, siteOrnamentedPortals, siteTargetPortals, fragments, config, blueprints, verbose);
    }).filter(site => site !== null);

    const seriesData = Object.fromEntries(processedSites.map(site => [site.geocode.id, site]));

    let totalAlignmentMismatches = 0;
    processedSites.forEach(site => {
        totalAlignmentMismatches += site.fullEvent?.counters?.alignmentMismatches || 0;

        // Remove alignmentMismatches from the final data as it's an internal flag only
        if (site.fullEvent?.counters) delete site.fullEvent.counters.alignmentMismatches;
        site.waves?.forEach(wave => {
            if (wave.counters) delete wave.counters.alignmentMismatches;
        });
    });

    if (totalAlignmentMismatches > 0 && !verbose) {
        console.warn(`⚠️ Alignment mismatches found: ${totalAlignmentMismatches}. Use --verbose for more details.`);
    }

    console.log(`ℹ️ ${Object.keys(seriesData).length} sites processed.\n`);
    return seriesData;
}

export function processSite(site, siteOrnamentedPortals, siteTargetPortals, fragments, seriesConfig, blueprints, verbose = false) {
    site.hasTargetData = siteTargetPortals && siteTargetPortals.length > 0;
    if (siteOrnamentedPortals && siteOrnamentedPortals.length > 0) {
        applyOrnamentedPortalsToSite(site, siteOrnamentedPortals);
    }

    if (siteTargetPortals && siteTargetPortals.length > 0) {
        applyTargetPortalsToSite(site, siteTargetPortals);
    }

    if (siteOrnamentedPortals?.length > 0 || siteTargetPortals?.length > 0) {
        site.centroid = calculateCentroid(site.portals);
    }

    if (fragments && fragments.length > 0) {
        applyFragmentPortalsToSite(site, fragments);
        applyFragmentsToSite(site, fragments, siteTargetPortals, seriesConfig, blueprints, verbose);
    }

    return site;
}

function applyTargetPortalsToSite(site, siteTargetPortals) {
    siteTargetPortals.forEach(t => {
        const key = getPortalKey(t);
        const created = createPortalForSite(site, key, t);
        if (created) {
            site.portals[created.id] = created.obj;
        }
    });
}

function applyFragmentsToSite(site, fragments, siteTargetPortals, seriesConfig, blueprints, verbose) {
    const siteEventType = site.geocode.eventType;
    const shardComponents = seriesConfig.shardComponents || [];
    const seriesEventConfig = shardComponents.find(et => et.eventType === siteEventType);

    // Find site-specific config for overrides
    let siteConfig = null;
    seriesEventConfig?.schedule?.forEach(sched => {
        const found = sched.sites?.find(s => s.name === site.geocode.name);
        if (found) siteConfig = found;
    });

    // Resolve blueprints
    const shardMechanic = seriesEventConfig ? blueprints.mechanics.shards[seriesEventConfig.shardMechanics] : null;

    site.fullEvent = processFragments({
        fragments,
        portalLookup: site[portalLookupByOriginalKey],
        sitePortals: site.portals,
        siteTargetPortals,
        eventType: siteEventType,
        geocode: site.geocode,
        fullEvent: true,
        verbose,
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
                siteTargetPortals: siteTargetPortals.filter(t => t.observedAt >= waveStart.getTime() && t.observedAt < waveEnd.getTime()),
                eventType: siteEventType,
                geocode: site.geocode,
                fullEvent: false,
                expectedQuantity: expectedQuantity,
                verbose,
            });

            waveViewData.period = {
                start: waveStart.getTime(),
                end: waveEnd.getTime()
            };

            site.waves.push(waveViewData);
        });
    }
}

function processFragments({ fragments, portalLookup, sitePortals, siteTargetPortals, eventType, geocode, fullEvent, verbose = false }) {
    const siteName = geocode.name;
    const viewData = {
        shards: [],
        shardPaths: {},
        targets: {
            RES: [],
            ENL: [],
        },
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
            targets: {
                RES: 0,
                ENL: 0,
            },
            alignmentMismatches: 0,
        },
    };

    // Populate targets if available
    if (siteTargetPortals) {
        // Unique targets for this view
        const uniqueTargets = new Map();

        siteTargetPortals.forEach(t => {
            const portalKey = getPortalKey({ title: t.title, latE6: Number(t.latE6), lngE6: Number(t.lngE6) });
            const portalId = portalLookup[portalKey];

            if (portalId && !uniqueTargets.has(`${portalId}-${t.faction}`)) {
                viewData.targets[t.faction].push(portalId);
                uniqueTargets.set(`${portalId}-${t.faction}`, true);
            }
        });

        // Ensure IDs are unique and sorted
        viewData.targets.RES = [...new Set(viewData.targets.RES)].sort((a, b) => a - b);
        viewData.targets.ENL = [...new Set(viewData.targets.ENL)].sort((a, b) => a - b);

        viewData.counters.targets.RES = viewData.targets.RES.length;
        viewData.counters.targets.ENL = viewData.targets.ENL.length;
    }

    for (const fragment of fragments.sort((a, b) => a.id.localeCompare(b.id))) {
        const shardId = parseInt(fragment.id.includes('_') ? fragment.id.slice(fragment.id.lastIndexOf('_') + 1) : fragment.id, 10);

        let mostRecentShardPortalKey;
        let shard;
        let allowFurtherPoints = true;
        for (const historyItem of fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))) {
            const originPortalKey = getPortalKey(historyItem.originPortalInfo);
            const destPortalKey = getPortalKey(historyItem.destinationPortalInfo);
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

                    const distance = roundToDecimalPlaces(haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    ), 2);

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
                        viewData.counters.alignmentMismatches++;
                        if (fullEvent && verbose) {
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

                    const distance = roundToDecimalPlaces(haversineDistance(
                        { latitude: originPortalObj.lat, longitude: originPortalObj.lng },
                        { latitude: destPortalObj.lat, longitude: destPortalObj.lng }
                    ), 2);

                    let points = 0;
                    if (allowFurtherPoints) {
                        const eventTypeRules = linkScoringRules.get(eventType);
                        const linkRule = getLinkRule(eventTypeRules, distance);
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

    viewData.counters.paths = Object.keys(viewData.shardPaths).length;
    return viewData;
}

function findSiteForFragment(fragment, sitesGeocode) {
    const fragmentCoords = getCoordsForFragment(fragment);

    let matchedSite = sitesGeocode.find(site => {
        const siteCoords = {
            latitude: site.lat,
            longitude: site.lng,
        };
        const distance = roundToDecimalPlaces(haversineDistance(fragmentCoords, siteCoords), 2);
        const isoPart = site.date.split('[')[0];
        const siteDate = DateTime.fromISO(isoPart, { zone: site.timezone }).toMillis();
        const matchingDate = isWithin24Hours(getFragmentSpawnTimeMs(fragment), siteDate);

        return (distance < SITE_AGGREGATION_DISTANCE && matchingDate);
    });
    return matchedSite;
}

function applyFragmentPortalsToSite(site, fragments) {
    for (const fragment of fragments.sort((a, b) => a.id.localeCompare(b.id))) {
        for (const historyItem of fragment.history.sort((a, b) => a.moveTimeMs.localeCompare(b.moveTimeMs))) {
            const originPortalKey = getPortalKey(historyItem.originPortalInfo);
            const destPortalKey = getPortalKey(historyItem.destinationPortalInfo);

            if (originPortalKey) {
                const originPortal = createPortalForSite(site, originPortalKey, historyItem.originPortalInfo);
                if (originPortal) {
                    site.portals[originPortal.id] = originPortal.obj;
                }
            }
            if (destPortalKey) {
                const destPortal = createPortalForSite(site, destPortalKey, historyItem.destinationPortalInfo);
                if (destPortal) {
                    site.portals[destPortal.id] = destPortal.obj;
                }
            }
        }
    }
}

function applyOrnamentedPortalsToSite(site, siteOrnamentedPortals) {
    for (const p of siteOrnamentedPortals) {
        const key = getPortalKey(p);

        let portalId = site[portalLookupByOriginalKey][key];
        if (portalId === undefined) {
            const created = createPortalForSite(site, key, p);
            if (created) {
                portalId = created.id;
                site.portals[portalId] = created.obj;
            }
        }

        if (portalId !== undefined) {
            const portalObj = site.portals[portalId];
            portalObj.ornamentId = p.ornamentId;
            portalObj.guid = p.guid;
        }
    }
}

function createPortalForSite(site, originalPortalKey, portalInfo) {
    let newPortal = null;
    if (!Object.hasOwn(site[portalLookupByOriginalKey], originalPortalKey)) {
        const portalId = site[portalIdCounter];
        site[portalLookupByOriginalKey][originalPortalKey] = portalId;

        const lat = portalInfo.latE6 !== undefined ? portalInfo.latE6 / 1e6 : portalInfo.lat;
        const lng = portalInfo.lngE6 !== undefined ? portalInfo.lngE6 / 1e6 : portalInfo.lng;

        newPortal = {
            id: portalId,
            obj: {
                title: portalInfo.title,
                lat,
                lng,
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
