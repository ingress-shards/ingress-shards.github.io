import { processShardSeriesData } from './shard-data-processor.js';

self.onmessage = function (event) {
    const { rawData, seriesSafeName } = event.data;

    try {
        const parsedData = JSON.parse(rawData);
        const processedData = processShardSeriesData(seriesSafeName, parsedData);
        self.postMessage({ status: "complete", data: processedData, seriesSafeName });
    } catch (error) {
        self.postMessage({ status: "error", message: error.message });
    }
};
