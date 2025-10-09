import { renderSeriesData } from "./shard-series-renderer.js";
import { getSeriesSafeName } from "../helpers.js";
import shardSeries from "../shard-series-metadata.json";

let _shardSeriesData = {};
let layer_lookup = {};
let layerControl;
let currentActiveSeriesLayer = null;
let activeSite = null;
let jsonParserWorker = null;

let backgroundRenderQueue = [];
let totalSeriesToRender = 0;
let seriesRendered = 0;

export function initMapControls(map) {
    var baseMaps = {
        OSM: L.tileLayer.provider("OpenStreetMap.Mapnik"),
        "CartoDB Positron": L.tileLayer.provider("CartoDB.Positron"),
        "CartoDB Dark Matter": L.tileLayer.provider("CartoDB.DarkMatter").addTo(map),
        "ESRI WorldImagery": L.tileLayer.provider("Esri.WorldImagery"),
        "Google Hybrid": L.tileLayer("http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}", {
            maxZoom: 20,
            subdomains: ["mt0", "mt1", "mt2", "mt3"],
        }),
    };
    layerControl = L.control.layers(baseMaps, {}, { position: "topleft" }).addTo(map);

    const shardSeriesNames = shardSeries.flatMap((s) => s.seriesName);
    for (const seriesName of shardSeriesNames) {
        const seriesSafeName = getSeriesSafeName(seriesName);
        $("#series").append(`<option value="${seriesSafeName}">${seriesName}</option>`);

        const seriesLayer = L.featureGroup();
        layer_lookup[seriesSafeName] = seriesLayer;
        layerControl.addOverlay(seriesLayer, seriesSafeName);
    }

    map.on('zoomend', updateAllPolylineStyles);
    map.on('moveend', updateAllPolylineStyles);
}

export async function initMapUI(shardSeriesData) {
    _shardSeriesData = shardSeriesData;
    updateLoadingDetails(0, "Rendering shard data...");

    let prioritySeriesDetails = getPrioritySeriesDetails(location.hash);
    let data = _shardSeriesData.find((e) => e.name === prioritySeriesDetails.seriesSafeName);
    if (!data) {
        console.warn(
            `Priority series ${prioritySeriesDetails.seriesSafeName} not found, defaulting to latest series`
        );
        prioritySeriesDetails = getPrioritySeriesDetails();
        data = _shardSeriesData.find((e) => e.name === prioritySeriesDetails.seriesSafeName);
    }
    prioritySeriesDetails.data = data;

    if (prioritySeriesDetails.data) {
        const seriesSafeName = prioritySeriesDetails.seriesSafeName;
        console.log(`Rendering priority series: ${seriesSafeName}`);
        const siteLayers = await renderSeriesData(seriesSafeName, prioritySeriesDetails.data);
        addSitesToSeriesLayer(seriesSafeName, siteLayers);

        $("#series").one("seriesDisplayComplete", () => {
            console.debug(
                `Series display complete. ${location.hash.length > 0 ? `Displaying site ${location.hash}` : ""
                }`
            );
            if ($(location.hash).length > 0) {
                $(location.hash).trigger("click");
            }
        });

        $("#series").val(seriesSafeName);
        displaySeries(seriesSafeName, "page_load"), 5000;
    }

    renderBackgroundSeries(prioritySeriesDetails);
}

function addSitesToSeriesLayer(seriesSafeName, siteLayers) {
    const seriesLayer = layer_lookup[seriesSafeName];
    siteLayers.forEach(sl => {
        const uniqueSiteId = seriesSafeName + "_" + sl.data.id.replace(" ", "_");
        layer_lookup[uniqueSiteId] = sl;

        sl.addTo(seriesLayer);
    });

}

function getPrioritySeriesDetails(locationHash) {
    let siteName =
        locationHash && locationHash.substring(1).replace("Abaddon_1", "").replace("abaddon1_", "");
    let seriesSafeName = getSeriesSafeName(shardSeries.at(-1).seriesName);
    if (siteName) {
        seriesSafeName = siteName.split("_").slice(0, -1).join("_");
    }
    return {
        seriesSafeName,
        siteName,
    };
}

async function renderBackgroundSeries(prioritySeries) {
    const seriesToRender = _shardSeriesData.filter((event) => {
        return getSeriesSafeName(event.name) !== prioritySeries.seriesSafeName;
    });

    seriesToRender.forEach((event) => {
        backgroundRenderQueue.push({ event, safeName: getSeriesSafeName(event.name) });
    });
    totalSeriesToRender = backgroundRenderQueue.length;
    console.log(`Total series to render in background: ${totalSeriesToRender}`);
    seriesRendered = 0;

    requestIdleCallback(renderNextSeries);
}

async function renderNextSeries(deadline) {
    while (deadline.timeRemaining() > 0 && backgroundRenderQueue.length > 0) {
        const nextItem = backgroundRenderQueue.shift();
        const { event, safeName } = nextItem;

        const siteLayers = await renderSeriesData(safeName, event);
        addSitesToSeriesLayer(safeName, siteLayers);

        seriesRendered++;
        updateLoadingDetails((seriesRendered / totalSeriesToRender) * 100);

        if (seriesRendered % 2 === 0) {
            await new Promise(requestAnimationFrame);
        }
    }

    if (backgroundRenderQueue.length > 0) {
        requestIdleCallback(renderNextSeries);
    } else {
        console.log("Background rendering complete.");
        updateLoadingDetails(100);
    }
}

export async function displaySeries(seriesName, source = "user") {
    console.debug(`Displaying series layer for: ${seriesName}`);
    $(".series").hide();

    $(`#${seriesName}`).show();
    $("button").off("click").on("click", siteButtonHandler).css("font-weight", "normal");

    if (currentActiveSeriesLayer && map.hasLayer(currentActiveSeriesLayer)) {
        map.removeLayer(currentActiveSeriesLayer);
    }
    activeSite = null;

    const newSeriesLayer = layer_lookup[seriesName];
    if (newSeriesLayer) {
        newSeriesLayer.addTo(map);
        currentActiveSeriesLayer = newSeriesLayer;

        if (source === "user" || location.hash === "" || !layer_lookup[location.hash.substring(1)]) {
            map.fitBounds(currentActiveSeriesLayer.getBounds());
        }

        $("#series").trigger("seriesDisplayComplete");
    } else {
        console.warn(`No layer found for series: ${seriesName}`);
    }
}

export function siteButtonHandler() {
    $(this).css("font-weight", "bold");
    $(this).siblings("button").css("font-weight", "normal");

    activeSite = layer_lookup[this.id];
    map.fitBounds(activeSite.getBounds());
    location.hash = this.id;
    activeSite.eachLayer(function (l) {
        if (l instanceof L.Polyline) {
            if (l.shardPath) l.shardPath.motionStart();
        }
    });
    updateAllPolylineStyles();
}

export async function handleCustomFile() {
    var file = this.files[0];
    if (!file) return;

    updateLoadingDetails(0, "Loading custom shard data...");
    await new Promise(requestAnimationFrame);

    let reader = new FileReader();
    reader.onload = async function (e) {
        const localRawJsonString = e.target.result;
        updateLoadingDetails(25, "Parsing custom shard data...");
        await new Promise(requestAnimationFrame);

        const seriesSafeName = getSeriesSafeName(file.name);
        jsonParserWorker = new Worker(new URL("../data/json-parser-worker.js", import.meta.url));
        jsonParserWorker.postMessage({
            rawData: localRawJsonString,
            seriesSafeName,
        });
        jsonParserWorker.onmessage = async (workerEvent) => {
            if (workerEvent.data.status === "complete") {
                updateLoadingDetails(50, "Rendering shard data...");
                await new Promise(requestAnimationFrame);

                const customShardSeriesData = workerEvent.data.data;

                const seriesLayer = L.featureGroup();
                layer_lookup[seriesSafeName] = seriesLayer;
                layerControl.addOverlay(seriesLayer, seriesSafeName);

                _shardSeriesData[seriesSafeName] = customShardSeriesData;
                const siteLayers = await renderSeriesData(seriesSafeName, customShardSeriesData);
                addSitesToSeriesLayer(seriesSafeName, siteLayers);

                $("#series").append(`<option value="${seriesSafeName}">${file.name}</option>`);
                $("#series").val(seriesSafeName).trigger("change");
                $("button").off("click").on("click", siteButtonHandler);

                updateLoadingDetails(100);
            }
        };
    };
    reader.readAsText(file);
}

export function updateLoadingDetails(progress, message) {
    const loadingOverlay = document.getElementById("loading-overlay");
    const loadingMessage = document.getElementById("loading-message");
    const loadingProgress = document.getElementById("loading-progress");

    if (progress !== undefined) {
        loadingProgress.value = progress;
    }
    if (message) {
        loadingMessage.textContent = message;
    }
    if (progress >= 100) {
        setTimeout(() => (loadingOverlay.style.display = "none"), 500);
    } else {
        loadingOverlay.style.display = "flex";
    }
}

// Dynamically create the dashes on links where there are bi-directional jumps
export function applyDynamicDashArray(polyline, map) {
    const VISIBLE_PATTERN_PIXELS = 90;

    const latlngs = polyline.getLatLngs();
    let totalDistancePixels = 0;

    for (let i = 0; i < latlngs.length - 1; i++) {
        const startPoint = map.latLngToLayerPoint(latlngs[i]);
        const endPoint = map.latLngToLayerPoint(latlngs[i + 1]);
        totalDistancePixels += startPoint.distanceTo(endPoint);
    }

    const G_middle_pixels = Math.max(0, totalDistancePixels - VISIBLE_PATTERN_PIXELS);

    const dashArraySegments = [
        10, 5, 5, 5, 5, 5, 5, 5,
        G_middle_pixels,
        5, 5, 5, 5, 5, 5, 5, 10
    ];

    polyline.setStyle({
        dashArray: dashArraySegments.join(',')
    });
}

function updateAllPolylineStyles() {
    if (!activeSite) return;

    activeSite.eachLayer(function (l) {
        if (l instanceof L.Polyline && l.biDirectionalJumps) {
            applyDynamicDashArray(l, map);
        }
    });
}