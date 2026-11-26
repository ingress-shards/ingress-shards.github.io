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
declare module "leaflet.motion";

import type * as L from "leaflet";
import type { ReliefOptions } from "leaflet-relief";

declare global {
    namespace L {
        namespace GridLayer {
            interface Relief {
                _tiles: Record<string, { active?: boolean; current?: boolean; coords?: L.Coords; el?: HTMLElement }>;
                _tileCoordsToKey(coords: L.Coords): string;
                _wrapCoords(coords: L.Coords): L.Coords;
            }
        }
    }
}

declare module "leaflet" {
    function maplibreGL(options: { style: string; renderWorldCopies?: boolean }): L.Layer;

    namespace tileLayer {
        function provider(providerName: string, options?: L.TileLayerOptions): L.TileLayer;
    }

    namespace GridLayer {
        type Relief = globalThis.L.GridLayer.Relief;
        const Relief: typeof globalThis.L.GridLayer.Relief;
    }

    namespace gridLayer {
        function relief(options?: ReliefOptions): globalThis.L.GridLayer.Relief;
    }
}
