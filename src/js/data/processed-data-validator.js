import { FACTION_COLORS } from "../constants.js";

const INDENT = '    ';

export function validateProcessedSeriesData(processedSeriesData, seriesConfig) {
    console.log(`ℹ️ Validating processed data: ${seriesConfig.name}, ${Object.keys(processedSeriesData).length} sites...`);
    const processedSites = Object.values(processedSeriesData);
    validateSites(processedSites, seriesConfig);
    console.log(`ℹ️ Validation complete.\n`);
}

function validateSites(processedSites, seriesConfig) {
    const seriesValidation = {
        eventTypes: {},
    };

    if (seriesConfig.eventTypes) {
        for (const [eventType, eventConfig] of Object.entries(seriesConfig.eventTypes)) {
            const totalShards = eventConfig.shards?.waves.reduce((sum, wave) => sum + (wave.quantity || 0), 0) || 0;

            const totalTargets =
                eventConfig.targets?.waves.reduce((sum, wave) => {
                    const factions = wave.factionQuantity || {};
                    const waveTotal = Object.values(factions).reduce((a, b) => a + b, 0);
                    return sum + waveTotal;
                }, 0) || 0;

            if (totalShards > 0 || totalTargets > 0) {
                seriesValidation.eventTypes[eventType] = {
                    totalShards,
                    totalTargets,
                };
            }
        }
    }

    for (const site of processedSites) {
        if (Object.entries(seriesValidation.eventTypes).length > 0) {
            const siteType = site.geocode.type;
            const { totalShards, totalTargets } = seriesValidation.eventTypes[siteType];
            if (site.fullEvent.shards.length !== totalShards) {
                console.log(`⚠️ Site ${site.geocode.id}: expected ${totalShards} shards but only ${site.fullEvent.shards.length} found.`)
            }
            if (site.fullEvent.targets) {
                if (site.fullEvent.targets.length !== totalTargets) {
                    console.log(`⚠️ Site ${site.geocode.id}: expected ${totalTargets} targets but only ${site.fullEvent.targets.length} found.`)
                }
            }
        }
        for (const [shardPathKey, shardPath] of Object.entries(site.fullEvent.shardPaths)) {
            if (shardPath.links && shardPath.jumps && shardPath.links.length > 0 && shardPath.jumps.length > 0) {
                console.log(`⚠️ Site ${site.geocode.id}: Shard path ${shardPathKey} with ${shardPath.links.length} links and ${shardPath.jumps.length}.`);
            }
            if (shardPath.jumps && shardPath.jumps.length > 1) {
                console.log(`⚠️ Site ${site.geocode.id}: ${shardPath.jumps.length} random teleports in shard path ${shardPathKey}.`);
            }

            if (shardPath.links && shardPath.links.length > 0) {
                const moveOrigins = new Set(shardPath.links.flatMap(link => link.moves).map(move => move.origin));
                const biDirectionalMoves = moveOrigins.size > 1;
                const sortedLinks = shardPath.links.sort((a, b) => a.linkTime - b.linkTime);

                let linkColor;
                let previousTeam;
                for (const [, link] of sortedLinks.entries()) {
                    if (linkColor && FACTION_COLORS[link.team] !== linkColor) {
                        const [portalAKey, portalBKey] = shardPathKey.split('-');
                        const portalA = site.portals[portalAKey];
                        const portalB = site.portals[portalBKey];

                        const biDirMessage = biDirectionalMoves ? `\n${INDENT}Note: There are bidirectional jumps too!` : '';
                        let multipleLinkDifferentFactionWarningMessage = `⚠️ Site ${site.geocode.id}: New link with different team!
${INDENT}Portal A: ${portalA.title} (${portalA.lat},${portalA.lng})
${INDENT}Portal B: ${portalB.title} (${portalB.lat},${portalB.lng})
${INDENT}Previous ${previousTeam}, Current ${link.team}${biDirMessage}`;
                        console.debug(multipleLinkDifferentFactionWarningMessage);
                    }
                    linkColor = FACTION_COLORS[link.team] || FACTION_COLORS.NEU;
                    previousTeam = link.team;
                }
            }
        }
    }
}