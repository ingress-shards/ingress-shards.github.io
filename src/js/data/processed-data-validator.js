import { FACTION_COLORS } from "../constants.js";

const INDENT = '    ';

export function validateProcessedSeriesData(processedSeriesData, seriesConfig, blueprints) {
    console.log(`ℹ️ Validating processed data: ${seriesConfig.name}, ${Object.keys(processedSeriesData).length} sites...`);
    const processedSites = Object.values(processedSeriesData);
    validateSites(processedSites, seriesConfig, blueprints);
    console.log(`ℹ️ Validation complete.\n`);
}

function validateSites(processedSites, seriesConfig, blueprints) {
    const seriesValidation = {
        brandConfigs: {},
    };

    if (seriesConfig.shardComponents) {
        seriesConfig.shardComponents.forEach(componentConfig => {
            const shardMechanic = (blueprints.mechanics?.shards || blueprints.shardMechanics)[componentConfig.shardMechanics];
            const targetMechanic = (blueprints.mechanics?.targets || blueprints.targetMechanics)[componentConfig.targetMechanics];

            const totalShards = shardMechanic?.waves.reduce((sum, wave) => sum + (wave.quantity || 0), 0) || 0;

            const totalTargets =
                targetMechanic?.waves.reduce((sum, wave) => {
                    const factions = wave.factionQuantity || {};
                    const waveTotal = Object.values(factions).reduce((a, b) => a + b, 0);
                    return sum + waveTotal;
                }, 0) || 0;

            seriesValidation.brandConfigs[componentConfig.brand] = {
                totalShards,
                totalTargets,
            };
        });
    }

    for (const site of processedSites) {
        if (Object.entries(seriesValidation.brandConfigs).length > 0) {
            const siteBrandId = site.geocode.brand;
            const componentConfig = seriesConfig.shardComponents?.find(et => et.brand === siteBrandId);

            // Resolve site override
            let siteConfig = null;
            componentConfig?.schedule?.forEach(sched => {
                const found = sched.sites?.find(s => s.name === site.geocode.name);
                if (found) siteConfig = found;
            });

            const brandConfig = seriesValidation.brandConfigs[siteBrandId];
            if (brandConfig && site.fullEvent) {
                const { totalTargets } = brandConfig;
                // Calculate expected shards (with per-site wave overrides support)
                let expectedShards;
                if (siteConfig && siteConfig.shardCounts) {
                    expectedShards = siteConfig.shardCounts.reduce((sum, count) => sum + count, 0);
                } else {
                    expectedShards = brandConfig.totalShards;
                }

                if (site.fullEvent.shards.length !== expectedShards) {
                    console.log(`⚠️ Site ${site.geocode.id}: expected ${expectedShards} shards but only ${site.fullEvent.shards.length} found.`)
                }
                if (site.fullEvent.targets) {
                    if (site.fullEvent.targets.length !== totalTargets) {
                        console.log(`⚠️ Site ${site.geocode.id}: expected ${totalTargets} targets but only ${site.fullEvent.targets.length} found.`)
                    }
                }
            }
        }

        if (site.fullEvent) {
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
}