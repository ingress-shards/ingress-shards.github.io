import { processShardSeriesData } from './shard-data-processor.js';

self.onmessage = function (event) {
    const { rawData, seriesSafeName, processType } = event.data;

    try {
        const parsedData = JSON.parse(rawData, reviver);

        if (processType === "custom_file") {
            const processedData = processShardSeriesData(seriesSafeName, parsedData);
            self.postMessage({ status: "complete", data: processedData, seriesSafeName });
        } else {
            self.postMessage({ status: "complete", data: parsedData });
        }
    } catch (error) {
        self.postMessage({ status: "error", message: error.message });
    }
};

function reviver(_key, value) {
    if (typeof value === 'object' && value !== null) {
        if (value.__map__ === true) {
            return new Map(value.data);
        }
    }
    return value;
}