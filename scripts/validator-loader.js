import eventBlueprints from "../conf/event_blueprints.json" with { type: "json" };
import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import { validateProcessedSeriesData } from "../src/js/data/shard-jumps/data-validator.js";
import { convertToCsv } from "../src/js/data/shard-jumps/data-helpers.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCESSED_DATA_PATH = path.join(__dirname, '..', 'gen', 'processed_series_data.json');
const REPORTS_DIR = path.join(__dirname, '..', 'gen', 'reports');

async function runValidator() {
    try {
        const verbose = process.argv.includes('--verbose');
        console.log(`ℹ️ Running shard jump integrity validator... (verbose: ${verbose})`);

        const content = await fs.readFile(PROCESSED_DATA_PATH, 'utf-8');
        const allSeriesData = JSON.parse(content);

        const allMissing = [];
        const allOutsideWindow = [];
        const allInvalidSequences = [];
        const allMismatches = [];

        const summary = {};

        for (const seriesConfig of seriesMetadata.series) {
            const processedData = allSeriesData[seriesConfig.id];
            if (!processedData) {
                continue;
            }
            console.log(`ℹ️ Validating processed data for ${seriesConfig.name}...`);
            const results = validateProcessedSeriesData(processedData, seriesConfig, eventBlueprints, verbose);
            if (results) {
                if (results.missingShardActions) allMissing.push(...results.missingShardActions);
                if (results.shardActionsOutsideJumpWindow) allOutsideWindow.push(...results.shardActionsOutsideJumpWindow);
                if (results.invalidShardSequences) allInvalidSequences.push(...results.invalidShardSequences);
                if (results.linkAlignmentMismatches) allMismatches.push(...results.linkAlignmentMismatches);

                const seasonId = seriesConfig.id;
                const siteIssues = {};

                results.missingShardActions?.forEach(row => {
                    const siteId = row.Site;
                    if (!siteIssues[siteId]) {
                        siteIssues[siteId] = { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    }
                    siteIssues[siteId].missing++;
                });

                results.shardActionsOutsideJumpWindow?.forEach(row => {
                    const siteId = row.Site;
                    if (!siteIssues[siteId]) {
                        siteIssues[siteId] = { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    }
                    siteIssues[siteId].outsideWindow++;
                });

                // Count unique invalid shard sequence entries by compound key
                const uniqueSequences = new Set();
                results.invalidShardSequences?.forEach(row => {
                    const siteId = row.Site;
                    const key = `${siteId}_${row.Wave}_${row['Shard ID']}`;
                    if (!uniqueSequences.has(key)) {
                        uniqueSequences.add(key);
                        if (!siteIssues[siteId]) {
                            siteIssues[siteId] = { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                        }
                        siteIssues[siteId].invalidSequences++;
                    }
                });

                results.linkAlignmentMismatches?.forEach(row => {
                    const siteId = row.Site;
                    if (!siteIssues[siteId]) {
                        siteIssues[siteId] = { missing: 0, outsideWindow: 0, invalidSequences: 0, linkAlignmentMismatches: 0 };
                    }
                    siteIssues[siteId].linkAlignmentMismatches++;
                });

                const seasonSummary = {};
                for (const [siteId, counts] of Object.entries(siteIssues)) {
                    const siteObj = {};
                    if (counts.missing > 1) {
                        siteObj.missingShardActions = counts.missing;
                    }
                    if (counts.outsideWindow > 1) {
                        siteObj.shardActionsOutsideJumpWindow = counts.outsideWindow;
                    }
                    if (counts.invalidSequences > 1) {
                        siteObj.invalidShardSequences = counts.invalidSequences;
                    }
                    if (counts.linkAlignmentMismatches > 0) {
                        siteObj.linkAlignmentMismatches = counts.linkAlignmentMismatches;
                    }

                    if (Object.keys(siteObj).length > 0) {
                        seasonSummary[siteId] = siteObj;
                    }
                }

                if (Object.keys(seasonSummary).length > 0) {
                    summary[seasonId] = seasonSummary;
                }
            }
        }

        // Ensure reports directory exists
        await fs.mkdir(REPORTS_DIR, { recursive: true });

        // Write CSV reports
        await fs.writeFile(path.join(REPORTS_DIR, 'missing-shard-actions.csv'), convertToCsv(allMissing), 'utf-8');
        await fs.writeFile(path.join(REPORTS_DIR, 'actions-outside-window.csv'), convertToCsv(allOutsideWindow), 'utf-8');
        await fs.writeFile(path.join(REPORTS_DIR, 'invalid-shard-sequences.csv'), convertToCsv(allInvalidSequences), 'utf-8');
        await fs.writeFile(path.join(REPORTS_DIR, 'link-alignment-mismatches.csv'), convertToCsv(allMismatches), 'utf-8');

        // Write master JSON summary
        await fs.writeFile(path.join(REPORTS_DIR, 'validation-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

        console.log('ℹ️ Validation complete and reports written under gen/reports/.\n');
    } catch (error) {
        console.error('❌ Error during validation:', error);
        process.exit(1);
    }
}

runValidator();

