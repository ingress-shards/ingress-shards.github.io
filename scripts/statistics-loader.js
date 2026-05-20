import eventBlueprints from "../conf/event_blueprints.json" with { type: "json" };
import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import { calculateStatisticsForSeason } from "../src/js/data/shard-jumps/data-statistics.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCESSED_DATA_PATH = path.join(__dirname, '..', 'gen', 'processed_series_data.json');

async function runStatistics() {
    try {
        console.log(`ℹ️ Calculating shard jump statistics...`);

        const content = await fs.readFile(PROCESSED_DATA_PATH, 'utf-8');
        const allSeriesData = JSON.parse(content);

        for (const seriesConfig of seriesMetadata.series) {
            const processedData = allSeriesData[seriesConfig.id];
            if (!processedData) {
                continue;
            }
            console.log(`\nℹ️ Statistics for ${seriesConfig.name}:`);
            calculateStatisticsForSeason(processedData, seriesConfig, eventBlueprints);
        }

        console.log('\nℹ️ Statistics calculation complete.');
    } catch (error) {
        console.error('❌ Error calculating statistics:', error);
        process.exit(1);
    }
}

runStatistics();
