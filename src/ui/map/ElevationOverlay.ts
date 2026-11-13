import * as L from "leaflet";
import "leaflet-relief";
import {
    decodeElevation,
    getTileElevationGrid,
    hsvToRgb,
    computeHillshadeIntensity,
} from "../../js/ui/map/elevation.js";
import type { ReliefGridLayer } from "../../types/ambient.js";

interface CachedTileRange {
    grid: Float32Array;
    points: L.LatLng[];
}

const TERRARIUM_TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

function elevationRatioToRgb(ratio: number): [number, number, number] {
    const hue = 210 - ratio * 180;
    const [r = 0, g = 0, b = 0] = hsvToRgb(hue, 1, 1);
    return [r, g, b];
}

class ElevationLegend extends L.Control {
    private div?: HTMLDivElement;

    constructor(private initialMin: number, private initialMax: number) {
        super({ position: "topleft" });
    }

    public override onAdd(): HTMLElement {
        this.div = L.DomUtil.create("div", "elevation-legend") as HTMLDivElement;
        this.update(this.initialMin, this.initialMax);
        return this.div;
    }

    public update(min: number, max: number): void {
        if (!this.div) return;
        const steps = 19;
        let html = "";
        for (let i = steps; i >= 0; i--) {
            const ratio = i / steps;
            const val = min + ratio * (max - min);
            const [r, g, b] = elevationRatioToRgb(ratio);
            html += `<div class="elevation-legend-item" style="background: rgb(${r},${g},${b});">${val.toFixed(0)} m</div>`;
        }
        this.div.innerHTML = html;
    }

    public show(): void {
        if (this.div) this.div.style.display = "block";
    }

    public hide(): void {
        if (this.div) this.div.style.display = "none";
    }
}

/**
 * Manages the Terrarium elevation relief grid layer, dynamic viewport color scale,
 * and accompanying legend control.
 */
export class ElevationOverlay {
    private currentMin = 0;
    private currentMax = 1000;
    private readonly legend = new ElevationLegend(this.currentMin, this.currentMax);
    private readonly reliefLayer: ReliefGridLayer;
    private readonly tileRangeCache = new Map<string, CachedTileRange>();
    private readonly sampleCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly map: L.Map) {
        this.reliefLayer = L.gridLayer.relief({
            mode: "hillshade",
            opacity: 0,
            maxNativeZoom: 15,
            minNativeZoom: 6,
            maxZoom: 20,
            minZoom: 6,
            elevationExtractor: decodeElevation,
        });

        this.reliefLayer._createHillshadeColor = (t: number[]): [number, number, number, number] => {
            const h = t[4] ?? 0;
            const intensity = computeHillshadeIntensity(t, this.reliefLayer._state);
            const span = this.currentMax - this.currentMin || 1;
            const ratio = Math.max(0, Math.min(1, (h - this.currentMin) / span));
            const [r, g, b] = elevationRatioToRgb(ratio);
            return [Math.round(r * intensity), Math.round(g * intensity), Math.round(b * intensity), 255];
        };

        this.reliefLayer.on("tileload", (event: L.TileEvent) => this.handleTileLoad(event));
        this.reliefLayer.on("add", () => {
            this.legend.addTo(this.map);
            setTimeout(() => this.updateViewRange(true), 50);
        });
        this.reliefLayer.on("remove", () => {
            this.legend.remove();
        });

        this.map.on("movestart zoomstart", () => {
            if (this.map.hasLayer(this.reliefLayer)) {
                this.reliefLayer.setOpacity(0);
                this.legend.hide();
            }
        });
        this.map.on("moveend zoomend", () => this.updateViewRange());
    }

    public get layer(): L.Layer {
        return this.reliefLayer;
    }

    private handleTileLoad(event: L.TileEvent): void {
        if (!this.sampleCtx) return;

        const sampleCtx = this.sampleCtx;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const grid = getTileElevationGrid(img, sampleCtx);
            if (!grid) return;

            const { z, x, y } = event.coords;
            const points: L.LatLng[] = [];
            for (let i = 0; i < 256; i++) {
                const px = (i % 16) * 16 + 8;
                const py = Math.floor(i / 16) * 16 + 8;
                points.push(this.map.unproject([x * 256 + px, y * 256 + py], z));
            }
            const key = this.reliefLayer._tileCoordsToKey(event.coords);
            this.tileRangeCache.set(key, { grid, points });
            this.updateViewRange();
        };
        img.src = L.Util.template(TERRARIUM_TILE_URL, event.coords);
    }

    private updateViewRange(force = false): void {
        if (this.updateTimer !== null) clearTimeout(this.updateTimer);
        const delay = force ? 10 : 100;

        this.updateTimer = setTimeout(() => {
            if (!this.map.hasLayer(this.reliefLayer)) return;

            const viewBounds = this.map.getBounds();
            let activeTileCount = 0;
            let allTilesReady = true;
            let min = 100000;
            let max = -100000;
            let found = false;

            for (const key in this.reliefLayer._tiles) {
                if (!this.reliefLayer._tiles[key]?.active) continue;
                activeTileCount++;

                const cachedData = this.tileRangeCache.get(key);
                if (!cachedData) {
                    allTilesReady = false;
                    continue;
                }

                const { grid, points } = cachedData;
                for (let i = 0; i < grid.length; i++) {
                    const h = grid[i];
                    const pt = points[i];
                    if (h === undefined || h === -99999 || h < -10 || !pt) continue;
                    if (viewBounds.contains(pt)) {
                        if (h < min) min = h;
                        if (h > max) max = h;
                        found = true;
                    }
                }
            }

            if (!force && (!allTilesReady || activeTileCount === 0)) return;

            if (found) {
                const threshold = Math.max(10, (this.currentMax - this.currentMin) * 0.1);
                const significantShift =
                    Math.abs(min - this.currentMin) > threshold ||
                    Math.abs(max - this.currentMax) > threshold;

                if (significantShift || force) {
                    if (significantShift) {
                        this.currentMin = min;
                        this.currentMax = max;
                    }
                    this.legend.update(this.currentMin, this.currentMax);
                    this.reliefLayer.redraw();
                }
                this.reliefLayer.setOpacity(0.6);
                this.legend.show();
            } else if (force) {
                this.reliefLayer.setOpacity(0.6);
                this.legend.show();
            }
        }, delay);
    }
}
