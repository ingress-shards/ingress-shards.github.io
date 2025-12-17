import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import seriesGeocode from "../gen/series_geocode.json" with { type: "json" };
import { processSeriesData } from '../src/js/data/shard-data-processor.js';
import { validateProcessedSeriesData } from "../src/js/data/processed-data-validator.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from "url";
import { FILE_PATTERNS } from "../src/js/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(__dirname, '..', 'gen');

async function runDataProcessor() {
    try {
        const startTime = performance.now();
        console.log(`ℹ️ Processing shard data for ${seriesMetadata.length} series...`);

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const allSeriesData = {};
        for (const seriesConfig of seriesMetadata) {
            const seriesId = seriesConfig.id
            const seriesDataFolder = path.join(DATA_DIR, seriesId);

            if (!fs.existsSync(seriesDataFolder)) {
                console.log(`⚠️ No raw data folder found for series ${seriesConfig.name}.\n`);
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
                console.log(`⚠️ No relevant raw data found for ${seriesConfig.name}.\n`);
                continue;
            }
            if (totalDataPoints !== filesInFolder.length) {
                console.log(`⚠️ Not all data in the folder ${seriesId} is being processed. Please check the code or the filenames to ensure correct processing.`);
            };

            const seriesDataPackage = {
                config: seriesConfig,
                geocode: seriesGeocode[seriesId],
                rawData: rawDataMap
            }
            const processedData = processSeriesData(seriesDataPackage);
            validateProcessedSeriesData(processedData, seriesConfig);

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