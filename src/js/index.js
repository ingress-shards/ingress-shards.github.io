import "leaflet/dist/leaflet.css";
import "github-fork-ribbon-css/gh-fork-ribbon.css";
import 'flag-icon-css/css/flag-icons.min.css';
import "../assets/main.css";
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
