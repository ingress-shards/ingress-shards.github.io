import * as L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet-providers";
import "leaflet.motion";
import { isTouchDevice } from "../touchSupport.js";
import type { BaseLayerName, MapState } from "../../state/MapState.js";
import { ElevationOverlay } from "./ElevationOverlay.js";

const CUSTOM_PANES: ReadonlyArray<{ name: string; zIndex: string }> = [
    { name: "ornamentPane", zIndex: "350" },
    { name: "ornamentFrontPane", zIndex: "625" },
    { name: "targetPane", zIndex: "630" },
    { name: "shardPane", zIndex: "640" },
];

function cartoLayer(styleName: string): L.Layer {
    const keyParam = __CARTO_API_KEY__ ? `?key=${__CARTO_API_KEY__}` : "";
    return L.maplibreGL({
        style: `https://basemaps.cartocdn.com/gl/${styleName}/style.json${keyParam}`,
    });
}

/**
 * Initializes and manages the Leaflet map instance, custom panes, base layers,
 * and overlays synced with MapState.
 */
export class MapManager {
    constructor(private readonly mapState: MapState) {}

    public initMap(): L.Map {
        const map = L.map("map", {
            worldCopyJump: true,
            minZoom: 2,
            doubleClickZoom: !isTouchDevice(),
        }).setView([0, 0], 2);

        for (const { name, zIndex } of CUSTOM_PANES) {
            map.createPane(name);
            const pane = map.getPane(name);
            if (pane) {
                pane.style.zIndex = zIndex;
                pane.style.pointerEvents = "none";
            }
        }

        const baseMaps: Record<BaseLayerName, L.Layer> = {
            OSM: L.tileLayer.provider("OpenStreetMap.Mapnik"),
            "CartoDB Positron": cartoLayer("positron-gl-style"),
            "CartoDB Dark Matter": cartoLayer("dark-matter-gl-style"),
            "CartoDB Voyager": cartoLayer("voyager-gl-style"),
            "ESRI WorldImagery": L.tileLayer.provider("Esri.WorldImagery"),
            "ESRI WorldTopoMap": L.tileLayer.provider("Esri.WorldTopoMap"),
            "Google Hybrid": L.tileLayer("http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}", {
                maxZoom: 20,
                subdomains: ["mt0", "mt1", "mt2", "mt3"],
            }),
        };

        const elevationOverlay = new ElevationOverlay(map);

        const preferences = this.mapState.getLayerPreferences();
        const baseLayer = baseMaps[preferences.baseLayer ?? "CartoDB Dark Matter"] ?? baseMaps["CartoDB Dark Matter"];
        baseLayer.addTo(map);

        map.on("baselayerchange", (e: L.LayersControlEvent) => {
            if (e.name in baseMaps) {
                this.mapState.setLayerPreferences({ baseLayer: e.name as BaseLayerName });
            }
        });

        map.on("overlayadd", (e: L.LayersControlEvent) => {
            if (e.name === "Elevation") {
                this.mapState.setLayerPreferences({ elevation: true });
            }
        });

        map.on("overlayremove", (e: L.LayersControlEvent) => {
            if (e.name === "Elevation") {
                this.mapState.setLayerPreferences({ elevation: false });
            }
        });

        L.control.layers(baseMaps, { Elevation: elevationOverlay.layer }, { position: "topleft" }).addTo(map);

        if (preferences.elevation) {
            elevationOverlay.layer.addTo(map);
        }

        return map;
    }
}
