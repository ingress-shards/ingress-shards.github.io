import { CUSTOM_SERIES_ID } from "../constants.js";
import { addCustomData } from "../data/data-store.js";
import { navigate } from "../router.js";
import { updateCustomSeriesLayer } from "./series-renderer.js";

export async function handleCustomFile(event) {
    var files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        await processSingleFile(file);
    }
}

export async function processSingleFile(customFile) {
    if (!customFile) return;

    let reader = new FileReader();
    reader.onload = async function (e) {
        const localRawJsonString = e.target.result;

        const jsonParserWorker = new Worker(new URL('../data/json-parser-worker.js', import.meta.url), { type: "module" });
        jsonParserWorker.postMessage({
            seriesId: CUSTOM_SERIES_ID,
            customFile: {
                fileName: customFile.name,
                rawData: localRawJsonString,
            }
        });
        jsonParserWorker.onmessage = async (workerEvent) => {
            if (workerEvent.data.status === "complete") {
                addCustomData(workerEvent.data.processedData);
                updateCustomSeriesLayer(CUSTOM_SERIES_ID);

                navigate(`#/${CUSTOM_SERIES_ID}`);

                jsonParserWorker.terminate();
            }
        };
    };
    reader.readAsText(customFile);
}

export function getDetailsPanelContent() {
    let content = `<input id="${CUSTOM_SERIES_ID}-file-input" class="series" type="file" accept="application/json" />`;

    return {
        title: `Custom Series Details`,
        content,
    };
}