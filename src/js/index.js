import "leaflet/dist/leaflet.css";
import "github-fork-ribbon-css/gh-fork-ribbon.css";
import 'flag-icon-css/css/flag-icons.min.css';
import "../assets/main.css";
import * as L from "leaflet";
import "leaflet-providers";
import "leaflet.motion";
import { initDataStore } from "./data/data-store.js";
import { initController } from "./ui/ui-controller.js";
import { IS_TOUCH_SUPPORTED } from "./ui/event-handler.js";

function initMap() {
    const map = L.map("map", {
        worldCopyJump: true,
        minZoom: 2,
        doubleClickZoom: !IS_TOUCH_SUPPORTED,
    }).setView([0, 0], 2);

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
    map.addControl(L.control.layers(baseMaps, {}, { position: "topleft" }));
    return map;
}

async function initApplication() {
    try {
        const map = initMap();
        await initDataStore();
        initController(map);
    } catch (error) {
        console.error("Failed to start application:", error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initApplication();
});
