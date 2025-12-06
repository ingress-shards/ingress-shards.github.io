import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import seriesGeocode from "../conf/series_geocode.json" with { type: "json" };
import { processSeriesData } from '../src/js/data/shard-data-processor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from "url";
import { FILE_PATTERNS } from "../src/js/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'processed');

async function runDataProcessor() {
    try {
        const startTime = performance.now();
        console.log(`Processing shard data for ${seriesMetadata.length} series...`);

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const allSeriesData = {};
        for (const seriesConfig of seriesMetadata) {
            const seriesId = seriesConfig.id
            console.log(`${seriesConfig.name}:`);
            const seriesDataFolder = path.join(DATA_DIR, seriesId);

            if (!fs.existsSync(seriesDataFolder)) {
                console.warn(`\t⚠️  No raw data folder found for series: ${seriesId}. Skipping.`);
                continue;
            }

            const rawDataMap = {};
            FILE_PATTERNS.forEach(p => {
                rawDataMap[p.type] = [];
            });

            const filesInFolder = fs.readdirSync(seriesDataFolder);
            for (const file of filesInFolder) {
                for (const pattern of FILE_PATTERNS) {
                    if (pattern.pattern.test(file)) {
                        const filePath = path.join(seriesDataFolder, file);
                        try {
                            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

                            if (Array.isArray(content)) {
                                rawDataMap[pattern.type].push(...content);
                            } else {
                                rawDataMap[pattern.type].push(content);
                            }
                        } catch (e) {
                            console.error(`❌ Error reading or parsing file: ${filePath}`, e);
                        }
                        break;
                    }
                }
            }

            const totalDataPoints = Object.values(rawDataMap).flat().length;
            if (totalDataPoints === 0) {
                console.log(`\t⚠️  No relevant raw data found for ${seriesId}. Skipping processing.`);
                continue;
            }
            if (totalDataPoints !== filesInFolder.length) {
                console.log(`\t⚠️  Not all data in the folder is being processed. Please check the code or the filenames to ensure correct processing.`);
            };

            const seriesDataPackage = {
                config: seriesConfig,
                geocode: seriesGeocode[seriesId],
                rawData: rawDataMap
            }
            const processedData = processSeriesData(seriesDataPackage);
            allSeriesData[seriesId] = processedData;
        }

        const outputFilePath = path.join(OUTPUT_DIR, `processed_series_data.json`);
        try {
            fs.writeFileSync(outputFilePath, JSON.stringify(allSeriesData), 'utf-8');
            const endTime = performance.now();

            console.log(`✅ Series data successfully saved to ${outputFilePath} in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
        } catch (e) {
            console.error(`❌ Failed to write output file.`, e);
        }
    } catch (error) {
        console.error('❌ Error during processing:', error);
        process.exit(1);
    }
}

runDataProcessor();