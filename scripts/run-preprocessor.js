import { readFileSync, writeFileSync } from 'fs';
import { processShardSeriesData } from '../src/js/data/shard-data-processor.js';
import { getSeriesSafeName } from "../src/js/helpers.js";
import shardSeries from "../src/js/shard-series-metadata.json" with { type: "json" };
import allData from '../all_data.json' with { type: "json" };

function main() {
    try {
        console.log('Pre-processing shard series data...');
        const startTime = performance.now();

        // const inputFileName = 'all_data.json';
        const outputFileName = 'processed_shard_series.json';

        // console.log(`Reading input file: ${inputFileName}`);
        // const rawJson = readFileSync(inputFileName, 'utf-8');
        // const parsedData = JSON.parse(rawJson);

        const processedData = [];
        for (const series of shardSeries) {
            const safeName = getSeriesSafeName(series.seriesName);
            const seriesData = allData[series.fileName];

            processedData.push(processShardSeriesData(safeName, seriesData));
        }

        writeFileSync('processed_shard_series.json', JSON.stringify(processedData, replacer), 'utf8');

        const endTime = performance.now();
        console.log(`Successfully processed data and saved to ${outputFileName}. ${processedData.length} series, ${processedData.flatMap(event => event.sites || []).length} sites in ${(endTime - startTime) / 1000} seconds`);

    } catch (error) {
        console.error('Error during preprocessing:', error);
        process.exit(1);

    }
}

function replacer(_key, value) {
    if (value instanceof Map) {
        return {
            __map__: true,
            data: Array.from(value.entries()),
        };
    }
    return value;
}

main();
