import { processShardSeriesData } from '../src/js/data/shard-data-processor.js';
import { getSeriesSafeName } from "../src/js/helpers.js";
import shardSeries from "../src/js/shard-series-metadata.json" with { type: "json" };
import allData from '../data/all_data.json' with { type: "json" };

function replacer(_key, value) {
    if (value instanceof Map) {
        return {
            __map__: true,
            data: Array.from(value.entries()),
        };
    }
    return value;
}

export default function () {
    try {
        console.log('Pre-processing shard series data...');
        const startTime = performance.now();

        const processedData = [];
        for (const series of shardSeries) {
            const safeName = getSeriesSafeName(series.seriesName);
            const seriesData = allData[series.fileName];

            processedData.push(processShardSeriesData(safeName, seriesData));
        }

        const endTime = performance.now();
        console.log(`Successfully processed data. ${processedData.length} series, ${processedData.flatMap(event => event.sites || []).length} sites in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

        return JSON.stringify(processedData, replacer);
    } catch (error) {
        console.error('Error during preprocessing:', error);
        process.exit(1);
    }
}
