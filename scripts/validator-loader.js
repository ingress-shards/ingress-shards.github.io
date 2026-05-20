import eventBlueprints from "../conf/event_blueprints.json" with { type: "json" };
import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import { validateProcessedSeriesData } from "../src/js/data/shard-jumps/data-validator.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCESSED_DATA_PATH = path.join(__dirname, '..', 'gen', 'processed_series_data.json');

async function runValidator() {
    try {
        const verbose = process.argv.includes('--verbose');
        console.log(`ℹ️ Running shard jump integrity validator... (verbose: ${verbose})`);

        const content = await fs.readFile(PROCESSED_DATA_PATH, 'utf-8');
        const allSeriesData = JSON.parse(content);

        for (const seriesConfig of seriesMetadata.series) {
            const processedData = allSeriesData[seriesConfig.id];
            if (!processedData) {
                continue;
            }
            console.log(`ℹ️ Validating processed data for ${seriesConfig.name}...`);
            validateProcessedSeriesData(processedData, seriesConfig, eventBlueprints, verbose);
        }

        console.log('ℹ️ Validation complete.\n');
    } catch (error) {
        console.error('❌ Error during validation:', error);
        process.exit(1);
    }
}

runValidator();
