import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEventConfigRegistry } from "../src/config/EventConfig.js";
import { validateProcessedSeasonData, type ValidationBlueprintsConfig, type ValidationSeriesConfig } from "./validation/Validator.js";
import { convertToCsv } from "./validation/CsvHelpers.js";
import { adaptRecordForValidation } from "./validation/SiteAdapter.js";
import type { SiteRecord } from "@ingress-shards/ingress-events-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "gen", "data");
const REPORTS_DIR = path.join(__dirname, "..", "gen", "reports");

async function runValidator(): Promise<void> {
    try {
        const startTime = performance.now();
        const registry = getEventConfigRegistry();
        const seasonIds = registry.getAllSeasonIds();

        console.log(`ℹ️ Running shard jump integrity validator across ${seasonIds.length} seasons...`);

        const allMissing: Record<string, unknown>[] = [];
        const allOutsideWindow: Record<string, unknown>[] = [];
        const allInvalidSequences: Record<string, unknown>[] = [];
        const allMismatches: Record<string, unknown>[] = [];
        const summary: Record<string, Record<string, Record<string, number>>> = {};

        for (const seasonId of seasonIds) {
            const seasonFilePath = path.join(DATA_DIR, `${seasonId}.json`);
            let records: Record<string, SiteRecord>;
            try {
                const content = await fs.readFile(seasonFilePath, "utf-8");
                records = JSON.parse(content);
            } catch {
                continue;
            }

            const seasonMetadata = registry.getSeasonMetadata(seasonId);
            const seriesConfig = {
                id: seasonId,
                components: seasonMetadata?.components?.map(c => ({
                    eventType: c.eventType,
                    startTime: c.startTime,
                    shardMechanics: c.mechanics?.shards?.shardMechanics,
                    targetMechanics: c.mechanics?.shards?.targetMechanics,
                    ...(c.schedule && { schedule: c.schedule }),
                })),
            };

            const adaptedSites = Object.values(records).map(r => adaptRecordForValidation(r, registry));
            const results = validateProcessedSeasonData(adaptedSites, seriesConfig as unknown as ValidationSeriesConfig, registry.blueprints as unknown as ValidationBlueprintsConfig);

            if (results) {
                allMissing.push(...results.missingShardActions);
                allOutsideWindow.push(...results.shardActionsOutsideJumpWindow);
                allInvalidSequences.push(...results.invalidShardSequences);
                allMismatches.push(...results.linkAlignmentMismatches);

                const siteIssues: Record<string, { missing: number; outsideWindow: number; invalidSequences: number; linkAlignmentMismatches: number }> = {};

                results.missingShardActions.forEach(row => {
                    const siteId = String(row.Site);
                    siteIssues[siteId] ??= { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    siteIssues[siteId].missing++;
                });

                results.shardActionsOutsideJumpWindow.forEach(row => {
                    const siteId = String(row.Site);
                    siteIssues[siteId] ??= { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    siteIssues[siteId].outsideWindow++;
                });

                const uniqueSequences = new Set<string>();
                results.invalidShardSequences.forEach(row => {
                    const siteId = String(row.Site);
                    const key = `${siteId}_${String(row.Wave)}_${String(row["Shard ID"])}`;
                    if (!uniqueSequences.has(key)) {
                        uniqueSequences.add(key);
                        siteIssues[siteId] ??= { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                        siteIssues[siteId].invalidSequences++;
                    }
                });

                results.linkAlignmentMismatches.forEach(row => {
                    const siteId = String(row.Site);
                    siteIssues[siteId] ??= { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    siteIssues[siteId].linkAlignmentMismatches++;
                });

                const seasonSummary: Record<string, Record<string, number>> = {};
                for (const [siteId, counts] of Object.entries(siteIssues)) {
                    const siteObj: Record<string, number> = {};
                    if (counts.missing > 1) siteObj.missingShardActions = counts.missing;
                    if (counts.outsideWindow > 1) siteObj.shardActionsOutsideJumpWindow = counts.outsideWindow;
                    if (counts.invalidSequences > 1) siteObj.invalidShardSequences = counts.invalidSequences;
                    if (counts.linkAlignmentMismatches > 0) siteObj.linkAlignmentMismatches = counts.linkAlignmentMismatches;

                    if (Object.keys(siteObj).length > 0) {
                        seasonSummary[siteId] = siteObj;
                    }
                }

                if (Object.keys(seasonSummary).length > 0) {
                    summary[seasonId] = seasonSummary;
                }
            }
        }

        await fs.mkdir(REPORTS_DIR, { recursive: true });
        await fs.writeFile(path.join(REPORTS_DIR, "missing-shard-actions.csv"), convertToCsv(allMissing), "utf-8");
        await fs.writeFile(path.join(REPORTS_DIR, "actions-outside-window.csv"), convertToCsv(allOutsideWindow), "utf-8");
        await fs.writeFile(path.join(REPORTS_DIR, "invalid-shard-sequences.csv"), convertToCsv(allInvalidSequences), "utf-8");
        await fs.writeFile(path.join(REPORTS_DIR, "link-alignment-mismatches.csv"), convertToCsv(allMismatches), "utf-8");
        await fs.writeFile(path.join(REPORTS_DIR, "validation-summary.json"), JSON.stringify(summary, null, 2), "utf-8");

        const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Validation complete and reports written to ${REPORTS_DIR} in ${durationSec} seconds.`);
    } catch (error) {
        console.error("❌ Error during validation:", error);
        process.exit(1);
    }
}

runValidator();
