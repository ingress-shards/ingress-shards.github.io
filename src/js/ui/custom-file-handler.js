import { CUSTOM_SEASON_ID } from "../constants.js";
import { addCustomData } from "../../data/SeasonDataStore.js";
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

        const jsonParserWorker = new Worker(
            new URL(
                /* webpackChunkName: "json-parser.worker" */
                '../data/json-parser-worker.js',
                import.meta.url
            ),
            { type: "module" }
        );
        jsonParserWorker.postMessage({
            seriesId: CUSTOM_SEASON_ID,
            customFile: {
                fileName: customFile.name,
                rawData: localRawJsonString,
            }
        });
        jsonParserWorker.onmessage = async (workerEvent) => {
            if (workerEvent.data.status === "complete") {
                addCustomData(workerEvent.data.processedData);
                updateCustomSeriesLayer(CUSTOM_SEASON_ID);

                navigate(`#/${CUSTOM_SEASON_ID}`);

                jsonParserWorker.terminate();
            }
        };
    };
    reader.readAsText(customFile);
}

export function getDetailsPanelContent() {
    let content = `<input id="${CUSTOM_SEASON_ID}-file-input" class="series" type="file" accept="application/json" />`;

    return {
        title: `Custom Season Details`,
        content,
    };
}