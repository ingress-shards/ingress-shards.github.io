import eventBlueprints from "../conf/event_blueprints.json" with { type: "json" };
import seriesMetadata from "../conf/series_metadata.json" with { type: "json" };
import seriesGeocode from "../gen/series_geocode.json" with { type: "json" };
import { processSeriesData } from '../src/js/data/shard-data-processor.js';
import { validateProcessedSeriesData } from "../src/js/data/processed-data-validator.js";
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from "url";
import { FILE_PATTERNS } from "../src/js/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(__dirname, '..', 'gen');

async function processSingleSeries(seriesConfig, verbose = false) {
    const seriesId = seriesConfig.id;
    const seriesDataFolder = path.join(DATA_DIR, seriesId);

    if (!existsSync(seriesDataFolder)) {
        console.log(`⚠️ No raw data folder found for series ${seriesConfig.name}.\n`);
        return null;
    }

    const rawDataMap = {};
    FILE_PATTERNS.forEach(p => {
        rawDataMap[p.type] = [];
    });

    const filesInFolder = await fs.readdir(seriesDataFolder);
    const fileLoadPromises = [];

    for (const file of filesInFolder) {
        for (const pattern of FILE_PATTERNS) {
            if (pattern.pattern.test(file)) {
                const filePath = path.join(seriesDataFolder, file);
                fileLoadPromises.push((async () => {
                    try {
                        const contentBuffer = await fs.readFile(filePath);
                        const content = JSON.parse(contentBuffer.toString());
                        return { type: pattern.type, content };
                    } catch (e) {
                        console.error(`❌ Error reading or parsing file: ${filePath}`, e);
                        return null;
                    }
                })());
                break;
            }
        }
    }

    const loadedFiles = (await Promise.all(fileLoadPromises)).filter(f => f !== null);
    loadedFiles.forEach(f => {
        if (Array.isArray(f.content)) {
            rawDataMap[f.type].push(...f.content);
        } else {
            rawDataMap[f.type].push(f.content);
        }
    });

    const totalDataPoints = Object.values(rawDataMap).flat().length;
    if (totalDataPoints === 0) {
        console.log(`⚠️ No relevant raw data found for ${seriesConfig.name}.\n`);
        return null;
    }

    const seriesDataPackage = {
        config: seriesConfig,
        geocode: seriesGeocode[seriesId],
        blueprints: eventBlueprints,
        rawData: rawDataMap,
        verbose
    };

    const processedData = processSeriesData(seriesDataPackage);
    validateProcessedSeriesData(processedData, seriesConfig, eventBlueprints, verbose);

    return { seriesId, processedData };
}

async function runDataProcessor() {
    try {
        const verbose = process.argv.includes('--verbose');
        const startTime = performance.now();
        console.log(`ℹ️ Processing shard data for ${seriesMetadata.series.length} series... (verbose: ${verbose})`);

        if (!existsSync(OUTPUT_DIR)) {
            mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        // Process all series in parallel
        const seriesPromises = seriesMetadata.series.map(config => processSingleSeries(config, verbose));
        const results = await Promise.all(seriesPromises);

        const allSeriesData = {};
        results.forEach(res => {
            if (res) {
                allSeriesData[res.seriesId] = res.processedData;
            }
        });

        const outputFilePath = path.join(OUTPUT_DIR, `processed_series_data.json`);
        try {
            await fs.writeFile(outputFilePath, JSON.stringify(allSeriesData), 'utf-8');
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