import * as L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet-providers";
import "leaflet.motion";
import { isTouchDevice } from "../touchSupport.js";
import type { BaseLayerName, MapState } from "../../state/MapState.js";
import { ElevationOverlay } from "./ElevationOverlay.js";

export const MAP_PANES = {
    ORNAMENT: "ornamentPane",
    ORNAMENT_FRONT: "ornamentFrontPane",
    TARGET: "targetPane",
    SHARD: "shardPane",
} as const;

export type MapPaneName = (typeof MAP_PANES)[keyof typeof MAP_PANES];

const CUSTOM_PANES: ReadonlyArray<{ name: MapPaneName; zIndex: string }> = [
    { name: MAP_PANES.ORNAMENT, zIndex: "350" },
    { name: MAP_PANES.ORNAMENT_FRONT, zIndex: "625" },
    { name: MAP_PANES.TARGET, zIndex: "630" },
    { name: MAP_PANES.SHARD, zIndex: "640" },
];

const WORLD_TILE_SIZE = 256;
export const GLOBE_CENTER: L.LatLngTuple = [10, 0];

function computeMinZoom(map: L.Map): number {
    const size = map.getSize();
    return Math.max(
        Math.log2(Math.max(size.x, WORLD_TILE_SIZE) / WORLD_TILE_SIZE),
        Math.log2(Math.max(size.y, WORLD_TILE_SIZE) / WORLD_TILE_SIZE)
    );
}

function cartoLayer(styleName: string): L.Layer {
    const keyParam = __CARTO_API_KEY__ ? `?key=${__CARTO_API_KEY__}` : "";
    return L.maplibreGL({
        style: `https://basemaps.cartocdn.com/gl/${styleName}/style.json${keyParam}`,
        renderWorldCopies: false,
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
            zoomSnap: 0,
            zoomDelta: 1,
            maxBounds: [
                [-85.0511, -180],
                [85.0511, 180],
            ],
            maxBoundsViscosity: 1.0,
            minZoom: 2,
            doubleClickZoom: !isTouchDevice(),
        });

        const initialMinZoom = computeMinZoom(map);
        map.setMinZoom(initialMinZoom);
        map.setView(GLOBE_CENTER, initialMinZoom);
        map.on("resize", () => {
            const nextMinZoom = computeMinZoom(map);
            map.setMinZoom(nextMinZoom);
            if (map.getZoom() < nextMinZoom) map.setZoom(nextMinZoom);
        });

        for (const { name, zIndex } of CUSTOM_PANES) {
            map.createPane(name);
            const pane = map.getPane(name);
            if (pane) {
                pane.style.zIndex = zIndex;
                pane.style.pointerEvents = "none";
            }
        }

        const baseMaps: Record<BaseLayerName, L.Layer> = {
            OSM: L.tileLayer.provider("OpenStreetMap.Mapnik", { noWrap: true }),
            "CartoDB Positron": cartoLayer("positron-gl-style"),
            "CartoDB Dark Matter": cartoLayer("dark-matter-gl-style"),
            "CartoDB Voyager": cartoLayer("voyager-gl-style"),
            "ESRI WorldImagery": L.tileLayer.provider("Esri.WorldImagery", { noWrap: true }),
            "ESRI WorldTopoMap": L.tileLayer.provider("Esri.WorldTopoMap", { noWrap: true }),
            "Google Hybrid": L.tileLayer("http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}", {
                maxZoom: 20,
                noWrap: true,
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
