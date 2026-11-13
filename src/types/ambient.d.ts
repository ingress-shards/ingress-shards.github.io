declare global {
    const __APP_VERSION__: string;
    const __CARTO_API_KEY__: string;
}

declare module "*.css";

declare module "*.png" {
    const src: string;
    export default src;
}

declare module "*.svg" {
    const src: string;
    export default src;
}

declare module "*.jpg" {
    const src: string;
    export default src;
}

declare module "*.jpeg" {
    const src: string;
    export default src;
}

declare module "*.gif" {
    const src: string;
    export default src;
}

declare module "leaflet-providers";
declare module "@maplibre/maplibre-gl-leaflet";
declare module "leaflet-relief";
declare module "leaflet.motion";

import type * as L from "leaflet";

export interface ReliefTileEntry {
    active?: boolean;
}

export interface ReliefGridLayer extends L.GridLayer {
    _tiles: Record<string, ReliefTileEntry>;
    _state: unknown;
    _tileCoordsToKey(coords: L.Coords): string;
    _createHillshadeColor?(tileData: number[]): [number, number, number, number];
}

export interface ReliefOptions extends L.GridLayerOptions {
    mode?: string;
    minNativeZoom?: number;
    maxNativeZoom?: number;
    elevationExtractor?: (r: number, g: number, b: number, a?: number) => number | null;
}

declare module "leaflet" {
    function maplibreGL(options: { style: string }): L.Layer;

    namespace tileLayer {
        function provider(providerName: string, options?: L.TileLayerOptions): L.TileLayer;
    }

    namespace gridLayer {
        function relief(options?: ReliefOptions): ReliefGridLayer;
    }
}
