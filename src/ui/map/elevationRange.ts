import type * as L from "leaflet";
import type { ElevationTileData } from "leaflet-relief";

export const ELEVATION_GRID_SIZE = 16;

const INVALID_ELEVATION = -99999;
const MIN_VALID_ELEVATION = -500;
const MAX_VALID_ELEVATION = 8850;

export interface CachedTileRange {
    grid: Float32Array;
    points: L.LatLng[];
}

export interface CachedTileEntry extends CachedTileRange {
    coords: L.Coords;
    tileData: ElevationTileData;
    renderedVersion: number;
}

export interface ViewportElevationStats {
    min: number;
    max: number;
    found: boolean;
    allTilesReady: boolean;
    activeTileCount: number;
}

/**
 * Samples a row-major `gridSize x gridSize` grid of elevations (in meters)
 * via a callback backed by `leaflet-relief`'s `_getElevation(tileData, x, y)`.
 * Invalid or out-of-range cells are recorded as `-99999`.
 */
export function sampleTileElevationGrid(
    tileSize: number,
    readElevation: (x: number, y: number) => number,
    gridSize = ELEVATION_GRID_SIZE
): Float32Array {
    const grid = new Float32Array(Math.max(0, gridSize * gridSize));
    if (tileSize <= 0 || gridSize <= 0) {
        grid.fill(INVALID_ELEVATION);
        return grid;
    }

    const step = tileSize / gridSize;
    for (let row = 0; row < gridSize; row++) {
        const py = Math.min(tileSize - 1, Math.floor((row + 0.5) * step));
        for (let col = 0; col < gridSize; col++) {
            const px = Math.min(tileSize - 1, Math.floor((col + 0.5) * step));
            const h = readElevation(px, py);
            const valid = Number.isFinite(h) && h >= MIN_VALID_ELEVATION && h <= MAX_VALID_ELEVATION;
            grid[row * gridSize + col] = valid ? h : INVALID_ELEVATION;
        }
    }
    return grid;
}

/**
 * Unprojects the 16x16 sample grid cell centers for a relief tile into geographic coordinates.
 */
export function computeTileSamplePoints(map: L.Map, coords: L.Coords, tileSize: number): L.LatLng[] {
    const points: L.LatLng[] = [];
    const step = tileSize / ELEVATION_GRID_SIZE;
    const originX = coords.x * tileSize;
    const originY = coords.y * tileSize;
    for (let row = 0; row < ELEVATION_GRID_SIZE; row++) {
        const py = Math.floor((row + 0.5) * step);
        for (let col = 0; col < ELEVATION_GRID_SIZE; col++) {
            points.push(map.unproject([originX + Math.floor((col + 0.5) * step), originY + py], coords.z));
        }
    }
    return points;
}

export interface ReliefTileRef { active?: boolean; current?: boolean; coords?: L.Coords; }

/**
 * Computes min/max elevation across current relief tiles intersecting `viewBounds`.
 * `null` cache entries represent settled empty/missing tiles so they do not stall readiness.
 */
export function collectViewportElevationStats(
    viewBounds: Pick<L.LatLngBounds, "contains">,
    tiles: Record<string, ReliefTileRef>,
    tileRangeCache: ReadonlyMap<string, CachedTileRange | null>,
    resolveCacheKey: (key: string, tile: ReliefTileRef) => string = (key) => key
): ViewportElevationStats {
    let activeTileCount = 0;
    let allTilesReady = true;
    let min = 100000;
    let max = -100000;
    let found = false;

    for (const key in tiles) {
        const tile = tiles[key];
        if (!tile?.current) continue;
        activeTileCount++;

        const cacheKey = resolveCacheKey(key, tile);
        if (!tileRangeCache.has(cacheKey)) {
            allTilesReady = false;
            continue;
        }

        const cachedData = tileRangeCache.get(cacheKey);
        if (!cachedData) continue;

        const { grid, points } = cachedData;
        for (let i = 0; i < grid.length; i++) {
            const h = grid[i];
            const pt = points[i];
            if (h === undefined || !Number.isFinite(h) || h < -10 || h > MAX_VALID_ELEVATION || !pt) continue;
            if (viewBounds.contains(pt)) {
                if (h < min) min = h;
                if (h > max) max = h;
                found = true;
            }
        }
    }

    return { min, max, found, allTilesReady, activeTileCount };
}

/**
 * Returns true on first terrain sample or when min/max shifts beyond 10% (min 10 m).
 */
export function shouldUpdateElevationRange(
    currentMin: number, currentMax: number, statsMin: number, statsMax: number, hasSampledRange: boolean
): boolean {
    if (!hasSampledRange) return true;
    const threshold = Math.max(10, (currentMax - currentMin) * 0.1);
    return Math.abs(statsMin - currentMin) > threshold || Math.abs(statsMax - currentMax) > threshold;
}

/**
 * Expands the active range monotonically during streaming tiles so extremes are not clipped,
 * deferring range tightening until all viewport tiles have settled.
 */
export function computeExpandedElevationRange(
    currentMin: number, currentMax: number, statsMin: number, statsMax: number
): { min: number; max: number } | null {
    const threshold = Math.max(10, (currentMax - currentMin) * 0.1);
    const min = statsMin < currentMin - threshold ? statsMin : currentMin;
    const max = statsMax > currentMax + threshold ? statsMax : currentMax;
    return min !== currentMin || max !== currentMax ? { min, max } : null;
}
