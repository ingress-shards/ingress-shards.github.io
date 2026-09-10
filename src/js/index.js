import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import "github-fork-ribbon-css/gh-fork-ribbon.css";
import "../../gen/flag-icons.css";
import "../assets/main.css";

setWorkerUrl(new URL('/js/maplibre-gl-worker.mjs', window.location.origin).href);
import { initMap } from "./ui/map/map-manager.js";
import { initDataStore } from "./data/data-store.js";
import { initController } from "./ui/ui-controller.js";

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
