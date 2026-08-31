import eventBlueprints from "../conf/event_blueprints.json" with { type: "json" };
import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import { calculateStatisticsForSeason } from "../src/js/data/shard-jumps/data-statistics.js";
import { convertToCsv } from "../src/js/data/shard-jumps/data-helpers.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'gen', 'data');
const REPORTS_DIR = path.join(__dirname, '..', 'gen', 'reports');

async function runStatistics() {
    try {
        const startTime = performance.now();
        console.log(`ℹ️ Calculating shard jump statistics...`);

        const allStats = [];

        for (const seriesConfig of seriesMetadata.series) {
            const seriesFilePath = path.join(DATA_DIR, `${seriesConfig.id}.json`);
            let processedData = null;
            try {
                const content = await fs.readFile(seriesFilePath, 'utf-8');
                processedData = JSON.parse(content);
            } catch {
                continue;
            }

            const seriesStats = calculateStatisticsForSeason(processedData, seriesConfig, eventBlueprints);
            if (seriesStats) {
                allStats.push(...seriesStats);
            }
        }

        // Ensure reports directory exists
        await fs.mkdir(REPORTS_DIR, { recursive: true });

        // Write CSV report
        const reportPath = path.join(REPORTS_DIR, 'site-statistics.csv');
        await fs.writeFile(reportPath, convertToCsv(allStats), 'utf-8');

        const endTime = performance.now();
        console.log(`\n✅ Statistics calculation complete and report written to ${reportPath} in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
    } catch (error) {
        console.error('❌ Error calculating statistics:', error);
        process.exit(1);
    }
}

runStatistics();

