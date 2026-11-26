import type { CachedTileEntry, ReliefTileRef } from "./elevationRange.js";

/** Repaints a tile's 2D canvas element in place via `paint`. */
export function repaintTileCanvas(
    el: HTMLElement | undefined,
    paint: (data: Uint8ClampedArray) => void
): boolean {
    if (!(el instanceof HTMLCanvasElement) || el.width === 0 || el.height === 0) return false;
    const ctx = el.getContext("2d");
    if (!ctx) return false;
    const imageData = ctx.createImageData(el.width, el.height);
    paint(imageData.data);
    ctx.putImageData(imageData, 0, 0);
    return true;
}

/** Collects keys of current tiles whose rendered version lags behind `targetVersion`. */
export function collectStaleTileKeys(
    tiles: Record<string, ReliefTileRef>,
    cache: ReadonlyMap<string, CachedTileEntry | null>,
    resolveKey: (key: string, tile: ReliefTileRef) => string,
    targetVersion: number
): string[] {
    const staleKeys: string[] = [];
    for (const key in tiles) {
        const tile = tiles[key];
        if (!tile?.current) continue;
        const cached = cache.get(resolveKey(key, tile));
        if (cached && cached.renderedVersion !== targetVersion) staleKeys.push(key);
    }
    return staleKeys;
}

/**
 * Spreads tile canvas recoloring across animation frames (1 valid tile per frame)
 * so range adjustments never block wheel zooming or panning.
 */
export class TileRecolorQueue {
    private frameId: number | null = null;
    private queue: string[] = [];

    constructor(private readonly paintKey: (key: string) => boolean) {}

    /** Cancels any pending work and schedules recoloring for `keys`. */
    public enqueue(keys: string[]): void {
        this.cancel();
        if (keys.length === 0) return;
        this.queue = keys;
        this.scheduleNext();
    }

    /** Aborts any pending animation frame and clears queued tile keys. */
    public cancel(): void {
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.frameId = null;
        this.queue = [];
    }

    private scheduleNext(): void {
        this.frameId = requestAnimationFrame(() => {
            this.frameId = null;
            while (this.queue.length > 0) {
                const key = this.queue.shift();
                if (key !== undefined && this.paintKey(key)) break;
            }
            if (this.queue.length > 0) this.scheduleNext();
        });
    }
}
