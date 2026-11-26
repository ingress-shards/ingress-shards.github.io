import type * as L from "leaflet";
import { describe, expect, it, vi } from "vitest";
import { elevationRatioToRgb, hsvToRgb } from "./elevationMath.js";
import {
    ELEVATION_GRID_SIZE,
    collectViewportElevationStats,
    computeExpandedElevationRange,
    sampleTileElevationGrid,
    shouldUpdateElevationRange,
    type CachedTileRange,
} from "./elevationRange.js";

function makePoint(lat: number, lng: number): L.LatLng {
    return { lat, lng } as L.LatLng;
}

describe("elevationMath", () => {
    describe("hsvToRgb and elevationRatioToRgb", () => {
        it("converts primary hues and guards boundary or non-finite hues", () => {
            expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
            expect(hsvToRgb(360, 1, 1)).toEqual([255, 0, 0]);
            expect(hsvToRgb(-120, 1, 1)).toEqual([0, 0, 255]);
            expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]);
            expect(hsvToRgb(Number.POSITIVE_INFINITY, 1, 1)).toEqual([0, 0, 0]);
        });

        it("maps ratio 0..1 across hypsometric hues and clamps outside [0, 1]", () => {
            expect(elevationRatioToRgb(0)).toEqual(hsvToRgb(210, 1, 1));
            expect(elevationRatioToRgb(1)).toEqual(hsvToRgb(30, 1, 1));
            expect(elevationRatioToRgb(-0.5)).toEqual(elevationRatioToRgb(0));
            expect(elevationRatioToRgb(1.5)).toEqual(elevationRatioToRgb(1));
        });
    });
});

describe("elevationRange", () => {
    describe("sampleTileElevationGrid", () => {
        it("samples (x, y) cell centers and filters out-of-range or non-finite values", () => {
            const readElevation = vi.fn((x: number, y: number): number => {
                if (x === 1 && y === 1) return Number.NaN;
                if (x === 3 && y === 1) return -600;
                if (x === 5 && y === 1) return 9000;
                return x * 10 + y;
            });

            const grid = sampleTileElevationGrid(32, readElevation);
            expect(grid).toHaveLength(ELEVATION_GRID_SIZE * ELEVATION_GRID_SIZE);
            expect(readElevation).toHaveBeenCalledWith(1, 1);
            expect(readElevation).toHaveBeenCalledWith(3, 1);
            expect(grid[0]).toBe(-99999);
            expect(grid[1]).toBe(-99999);
            expect(grid[2]).toBe(-99999);
            expect(grid[3]).toBe(7 * 10 + 1);
            expect(grid[ELEVATION_GRID_SIZE]).toBe(1 * 10 + 3);
        });

        it("fills invalid elevation when tileSize <= 0", () => {
            const readElevation = vi.fn(() => 100);
            expect(Array.from(sampleTileElevationGrid(0, readElevation, 2))).toEqual([-99999, -99999, -99999, -99999]);
            expect(readElevation).not.toHaveBeenCalled();
        });
    });

    describe("collectViewportElevationStats", () => {
        const bounds = {
            contains: (pt: L.LatLng) => pt.lat >= 0 && pt.lat <= 10 && pt.lng >= 0 && pt.lng <= 10,
        };

        it("aggregates min/max inside bounds and ignores out-of-range values", () => {
            const cache = new Map<string, CachedTileRange | null>([
                [
                    "t1",
                    {
                        grid: new Float32Array([-99999, -20, 120, 840, 9000, 999]),
                        points: [
                            makePoint(1, 1),
                            makePoint(2, 2),
                            makePoint(3, 3),
                            makePoint(4, 4),
                            makePoint(5, 5),
                            makePoint(25, 25),
                        ],
                    },
                ],
                ["t-empty", null],
            ]);

            const stats = collectViewportElevationStats(
                bounds,
                {
                    t1: { current: true },
                    "t-empty": { current: true },
                    staleZoom: { current: false, active: true },
                    pending: { current: true },
                },
                cache
            );

            // `pending` is missing from cache so readiness stays false; `staleZoom` is ignored
            expect(stats.allTilesReady).toBe(false);
            expect(stats.activeTileCount).toBe(3);
            expect(stats.found).toBe(true);
            expect(stats.min).toBe(120);
            expect(stats.max).toBe(840);
        });

        it("treats settled null tiles as ready", () => {
            const cache = new Map<string, CachedTileRange | null>([["t-empty", null]]);
            const stats = collectViewportElevationStats(bounds, { "t-empty": { current: true } }, cache);
            expect(stats).toEqual({
                min: 100000,
                max: -100000,
                found: false,
                allTilesReady: true,
                activeTileCount: 1,
            });
        });
    });

    describe("shouldUpdateElevationRange", () => {
        it("always updates on first real terrain sample even within 10% of 0-1000 m", () => {
            expect(shouldUpdateElevationRange(0, 1000, 30, 950, false)).toBe(true);
        });

        it("enforces max(10, 10% span) threshold after initial sample", () => {
            expect(shouldUpdateElevationRange(0, 1000, 50, 960, true)).toBe(false);
            expect(shouldUpdateElevationRange(0, 1000, 110, 1000, true)).toBe(true);
            expect(shouldUpdateElevationRange(10, 30, 15, 38, true)).toBe(false);
            expect(shouldUpdateElevationRange(10, 30, 15, 41, true)).toBe(true);
        });
    });

    describe("computeExpandedElevationRange", () => {
        it("returns null inside threshold or when stream range is narrower", () => {
            expect(computeExpandedElevationRange(100, 1100, 200, 900)).toBeNull();
            expect(computeExpandedElevationRange(100, 1100, 50, 1150)).toBeNull();
        });

        it("expands only bounds exceeding max(10, 10% span)", () => {
            expect(computeExpandedElevationRange(100, 1100, -10, 1150)).toEqual({ min: -10, max: 1100 });
            expect(computeExpandedElevationRange(100, 1100, 120, 1300)).toEqual({ min: 100, max: 1300 });
            expect(computeExpandedElevationRange(20, 40, 5, 55)).toEqual({ min: 5, max: 55 });
        });
    });
});
