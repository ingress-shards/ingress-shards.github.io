import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import "github-fork-ribbon-css/gh-fork-ribbon.css";
import "../gen/flag-icons.css";
import "@ingress-shards/ingress-events-core/visuals/tokens.css";
import "./assets/main.css";

import eventBlueprints from "@ingress-shards/ingress-events-core/conf/event_blueprints.json";
import seasonManifest from "@ingress-shards/ingress-events-core/conf/season_manifest.json";
import seasonGeocode from "@ingress-shards/ingress-events-core/conf/season_geocode.json";
import {
    ConfigRegistry,
    type EventBlueprints,
    type SeasonGeocode,
    type SeasonManifest,
} from "@ingress-shards/ingress-events-core";

import { seasonDataStore } from "./data/SeasonDataStore.js";
import { registerLegacyRouter, Router } from "./routing/Router.js";
import { MapState } from "./state/MapState.js";
import { initTouchSuppression } from "./ui/touchSupport.js";
import { MapManager } from "./ui/map/MapManager.js";
import { UIController } from "./ui/UIController.js";

setWorkerUrl(new URL("/js/maplibre-gl-worker.mjs", window.location.origin).href);

class IngressShardsMap {
    private readonly configRegistry: ConfigRegistry;
    private readonly mapState: MapState;
    private readonly router: Router;
    private readonly mapManager: MapManager;

    constructor() {
        this.configRegistry = new ConfigRegistry(
            eventBlueprints as EventBlueprints,
            seasonManifest as SeasonManifest,
            seasonGeocode as SeasonGeocode
        );
        this.mapState = new MapState();
        this.router = new Router(this.mapState, this.configRegistry.getDefaultSeasonId());
        this.mapManager = new MapManager(this.mapState);
        registerLegacyRouter(this.router);
    }

    public start(): void {
        try {
            initTouchSuppression();
            this.router.start();
            const map = this.mapManager.initMap();
            const controller = new UIController(
                map,
                this.configRegistry,
                seasonDataStore,
                this.mapState,
                this.router
            );
            controller.init();
        } catch (error) {
            console.error("Failed to start application:", error);
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const app = new IngressShardsMap();
    app.start();
});
