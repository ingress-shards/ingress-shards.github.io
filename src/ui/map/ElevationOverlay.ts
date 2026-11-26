import * as L from "leaflet";
import "leaflet-relief";
import { ElevationLegend, type ElevationLegendView } from "./ElevationLegend.js";
import { elevationRatioToRgb } from "./elevationMath.js";
import {
    collectViewportElevationStats, computeExpandedElevationRange, computeTileSamplePoints,
    sampleTileElevationGrid, shouldUpdateElevationRange, type CachedTileEntry, type ReliefTileRef,
} from "./elevationRange.js";
import { collectStaleTileKeys, repaintTileCanvas, TileRecolorQueue } from "./TileRecolorQueue.js";

const NOOP_RGB: [number, number, number] = [0, 0, 0];

/**
 * Manages the Mapterhorn elevation relief grid layer with progressive tile coloring,
 * non-blocking 1-tile-per-frame adjustments, and an accompanying legend control.
 */
export class ElevationOverlay {
    private currentMin = 0;
    private currentMax = 1000;
    private rangeVersion = 0;
    private hasSampledRange = false;
    private lastHillshadeIntensity = 1;
    private readonly reliefLayer: L.GridLayer.Relief;
    private readonly tileRangeCache = new Map<string, CachedTileEntry | null>();
    private readonly recolorQueue = new TileRecolorQueue((key) => this.recolorTileByKey(key));
    private originalFillTile!: L.GridLayer.Relief["_fillHillshadeTile"];
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly resolveTileKey = (key: string, tile: ReliefTileRef): string =>
        tile.coords ? this.toCacheKey(tile.coords) : key;

    constructor(private readonly map: L.Map, private readonly legend: ElevationLegendView = new ElevationLegend(0, 1000)) {
        const { elevationUrls, elevationAttributions, elevationMaxNativeZooms, elevationExtractors } = L.GridLayer.Relief;
        this.reliefLayer = L.gridLayer.relief({
            mode: "hillshade", hillshadeExaggeration: 3, opacity: 0, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1, noWrap: true,
            elevationUrl: elevationUrls.mapterhorn, attribution: elevationAttributions.mapterhorn,
            maxNativeZoom: elevationMaxNativeZooms.mapterhorn, minNativeZoom: 6, maxZoom: 20, minZoom: 6,
            elevationExtractor: (r, g, b, a) => (a < 255 ? -99999 : elevationExtractors.mapterhorn(r, g, b, a)),
            hillshadeColorFunction: (intensity) => { this.lastHillshadeIntensity = intensity; return NOOP_RGB; },
        });
        this.installReliefHooks();
        this.bindEvents();
    }

    public get layer(): L.Layer { return this.reliefLayer; }

    private toCacheKey(coords: L.Coords): string {
        return this.reliefLayer._tileCoordsToKey(this.reliefLayer._wrapCoords(coords));
    }

    private collectStats() {
        return collectViewportElevationStats(this.map.getBounds(), this.reliefLayer._tiles, this.tileRangeCache, this.resolveTileKey);
    }

    private applyRange(min: number, max: number): void {
        this.currentMin = min;
        this.currentMax = max;
        this.rangeVersion++;
        this.legend.update(min, max);
    }

    private installReliefHooks(): void {
        const originalCreateColor = this.reliefLayer._createHillshadeColor.bind(this.reliefLayer);
        this.reliefLayer._createHillshadeColor = (zData, pixelSizeMeters) => {
            originalCreateColor(zData, pixelSizeMeters);
            const h = zData[4] ?? 0;
            const span = this.currentMax - this.currentMin || 1;
            const [r, g, b] = elevationRatioToRgb((h - this.currentMin) / span);
            const k = this.lastHillshadeIntensity;
            return [Math.round(r * k), Math.round(g * k), Math.round(b * k), 255];
        };

        this.originalFillTile = this.reliefLayer._fillHillshadeTile.bind(this.reliefLayer);
        this.reliefLayer._fillHillshadeTile = (data, tileData, coords, abortSignal) => {
            if (abortSignal?.aborted) return;
            const key = this.toCacheKey(coords);
            let entry = this.tileRangeCache.get(key) ?? null;
            if (!entry) {
                const tileSize = this.reliefLayer.getTileSize().x;
                entry = {
                    grid: sampleTileElevationGrid(tileSize, (px, py) => this.reliefLayer._getElevation(tileData, px, py)),
                    points: computeTileSamplePoints(this.map, coords, tileSize), coords, tileData, renderedVersion: -1,
                };
                this.tileRangeCache.set(key, entry);
            }
            if (!this.hasSampledRange) return;
            const stats = this.collectStats();
            const expanded = stats.found ? computeExpandedElevationRange(this.currentMin, this.currentMax, stats.min, stats.max) : null;
            if (expanded) this.applyRange(expanded.min, expanded.max);
            this.originalFillTile(data, tileData, coords, abortSignal);
            entry.renderedVersion = this.rangeVersion;
        };
    }

    private recolorTileByKey(key: string): boolean {
        if (!this.map.hasLayer(this.reliefLayer)) { this.recolorQueue.cancel(); return false; }
        const tile = this.reliefLayer._tiles[key];
        const cached = tile?.current ? this.tileRangeCache.get(this.resolveTileKey(key, tile)) : null;
        if (!cached || cached.renderedVersion === this.rangeVersion) return false;
        const painted = repaintTileCanvas(tile?.el, (data) => this.originalFillTile(data, cached.tileData, cached.coords));
        if (painted) cached.renderedVersion = this.rangeVersion;
        return painted;
    }

    private bindEvents(): void {
        const onSettled = (event: L.TileEvent): void => {
            const key = this.toCacheKey(event.coords);
            if (!this.tileRangeCache.has(key)) this.tileRangeCache.set(key, null);
            this.scheduleViewRangeUpdate();
        };
        this.reliefLayer.on("tileload", onSettled);
        this.reliefLayer.on("tileerror", onSettled);
        this.reliefLayer.on("tileunload", (event: L.TileEvent) => this.tileRangeCache.delete(this.toCacheKey(event.coords)));
        this.reliefLayer.on("add", () => {
            this.hasSampledRange = false; this.reliefLayer.setOpacity(0); this.legend.addTo(this.map); this.scheduleViewRangeUpdate();
        });
        this.reliefLayer.on("remove", () => {
            this.cancelPendingUpdates(); this.hasSampledRange = false; this.tileRangeCache.clear(); this.legend.remove();
        });
        this.map.on("movestart zoomstart", () => this.cancelPendingUpdates());
        this.map.on("moveend zoomend", () => this.scheduleViewRangeUpdate());
    }

    private cancelPendingUpdates(): void {
        if (this.updateTimer !== null) clearTimeout(this.updateTimer);
        this.updateTimer = null; this.recolorQueue.cancel();
    }

    private scheduleViewRangeUpdate(): void {
        if (this.updateTimer !== null) clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => {
            if (!this.map.hasLayer(this.reliefLayer)) return;
            const stats = this.collectStats();
            if (stats.activeTileCount === 0) {
                this.recolorQueue.cancel(); this.hasSampledRange = false;
                this.reliefLayer.setOpacity(0); this.legend.hide(); return;
            }
            if (stats.allTilesReady && !stats.found) { this.legend.hide(); return; }
            if (!stats.allTilesReady || !stats.found) return;
            if (shouldUpdateElevationRange(this.currentMin, this.currentMax, stats.min, stats.max, this.hasSampledRange)) {
                this.hasSampledRange = true;
                this.applyRange(stats.min, stats.max);
            }
            this.recolorQueue.enqueue(collectStaleTileKeys(this.reliefLayer._tiles, this.tileRangeCache, this.resolveTileKey, this.rangeVersion));
            this.reliefLayer.setOpacity(0.6);
            this.legend.show();
        }, 100);
    }
}
