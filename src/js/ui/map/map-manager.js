import * as L from "leaflet";
import "leaflet-providers";
import "leaflet.motion";
import "leaflet-relief";
import { IS_TOUCH_SUPPORTED } from "../event-handler.js";
import { decodeElevation, getTileElevationGrid, hsvToRgb, computeHillshadeIntensity } from "./elevation.js";

export function initMap() {
    const map = L.map("map", {
        worldCopyJump: true,
        minZoom: 2,
        doubleClickZoom: !IS_TOUCH_SUPPORTED,
    }).setView([0, 0], 2);

    createCustomPanes(map);

    const baseMaps = {
        OSM: L.tileLayer.provider("OpenStreetMap.Mapnik"),
        "CartoDB Positron": L.tileLayer.provider("CartoDB.Positron"),
        "CartoDB Dark Matter": L.tileLayer.provider("CartoDB.DarkMatter").addTo(map),
        "ESRI WorldImagery": L.tileLayer.provider("Esri.WorldImagery"),
        "ESRI WorldTopoMap": L.tileLayer.provider('Esri.WorldTopoMap'),
        "Google Hybrid": L.tileLayer("http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}", {
            maxZoom: 20,
            subdomains: ["mt0", "mt1", "mt2", "mt3"],
        }),
    };

    let currentMin = 0, currentMax = 1000;

    // --- Dynamic Elevation Legend ---
    const ElevationLegend = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            this._div = L.DomUtil.create('div', 'elevation-legend');
            this._div.style.background = 'rgba(255, 255, 255, 0.9)';
            this._div.style.border = '1px solid #ccc';
            this._div.style.borderRadius = '2px';
            this._div.style.fontSize = '12px';
            this._div.style.fontFamily = 'monospace';
            this._div.style.fontWeight = 'bold';
            this._div.style.marginTop = '10px';
            this._div.style.width = '75px';
            // Start visible if the layer is on, otherwise hidden until data confirms visibility
            this._div.style.display = 'none';
            this.update(currentMin, currentMax);
            return this._div;
        },
        update: function (min, max) {
            const steps = 19;
            let html = '';
            for (let i = steps; i >= 0; i--) {
                const ratio = i / steps;
                const val = min + ratio * (max - min);
                const hue = 210 - ratio * 180;
                const rgb = hsvToRgb(hue, 1, 1);

                html += `
                    <div style="background: rgb(${rgb[0]},${rgb[1]},${rgb[2]}); color: #000; text-align: center; white-space: nowrap; overflow: hidden; padding: 1px 0;">
                        ${val.toFixed(0)} m
                    </div>`;
            }
            this._div.innerHTML = html;
        },
        show: function () { this._div.style.display = 'block'; },
        hide: function () { this._div.style.display = 'none'; }
    });
    const legend = new ElevationLegend();

    // --- Relief Layer Customization ---
    const reliefLayer = L.gridLayer.relief({
        mode: 'hillshade',
        opacity: 0,
        maxNativeZoom: 15,
        minNativeZoom: 6,
        maxZoom: 20,
        minZoom: 6,
        elevationExtractor: decodeElevation
    });

    reliefLayer._createHillshadeColor = function (t) {
        const h = t[4];
        const intensity = computeHillshadeIntensity(t, this._state);
        // CRITICAL SCALE PARITY: Ensure divisor matches legend exactly
        const span = (currentMax - currentMin) || 1;
        const ratio = Math.max(0, Math.min(1, (h - currentMin) / span));
        const hue = 210 - ratio * 180;
        const [r, g, b] = hsvToRgb(hue, 1, 1);
        return [Math.round(r * intensity), Math.round(g * intensity), Math.round(b * intensity), 255];
    };

    const tileRangeCache = new Map();
    const sampleCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

    let updateTimer = null;
    const updateViewRange = (force = false) => {
        if (updateTimer) clearTimeout(updateTimer);
        const delay = force ? 10 : 100;

        updateTimer = setTimeout(() => {
            const viewBounds = map.getBounds();

            let allTilesReady = true;
            let activeTileCount = 0;
            for (let key in reliefLayer._tiles) {
                const tileObj = reliefLayer._tiles[key];
                if (!tileObj.active) continue;
                activeTileCount++;
                if (!tileRangeCache.has(key)) {
                    allTilesReady = false;
                    break;
                }
            }

            // Ensure we only proceed if we have data, unless it's a force update where we might be waiting for first tiles
            if (!force && (!allTilesReady || activeTileCount === 0)) return;

            let min = 100000, max = -100000, found = false;
            for (let key in reliefLayer._tiles) {
                const tileObj = reliefLayer._tiles[key];
                if (!tileObj.active) continue;

                const cachedData = tileRangeCache.get(key);
                if (!cachedData) continue;

                const { grid, points } = cachedData;
                for (let i = 0; i < grid.length; i++) {
                    const h = grid[i];
                    if (h === -99999) continue;
                    if (viewBounds.contains(points[i])) {
                        if (h < -10) continue;
                        if (h < min) min = h;
                        if (h > max) max = h;
                        found = true;
                    }
                }
            }

            // Always attempt to show legend/layer if force or found
            if (map.hasLayer(reliefLayer)) {
                if (found) {
                    const currentSpan = currentMax - currentMin;
                    const threshold = Math.max(10, currentSpan * 0.1);
                    const significantShift = Math.abs(min - currentMin) > threshold || Math.abs(max - currentMax) > threshold || force;

                    if (significantShift) {
                        currentMin = min;
                        currentMax = max;
                        legend.update(min, max);
                        reliefLayer.redraw();
                    } else if (force) {
                        legend.update(currentMin, currentMax);
                        reliefLayer.redraw();
                    }
                    reliefLayer.setOpacity(0.6);
                    legend.show();
                } else if (force) {
                    // Even if no terrain points found yet (tiles loading), reveal the legend if forced
                    reliefLayer.setOpacity(0.6);
                    legend.show();
                }
            }
        }, delay);
    };

    reliefLayer.on('tileload', (event) => {
        const url = L.Util.template('https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png', event.coords);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const grid = getTileElevationGrid(img, sampleCtx);
            if (grid) {
                const { z, x, y } = event.coords;
                const points = [];
                for (let i = 0; i < 256; i++) {
                    const px = (i % 16) * 16 + 8;
                    const py = Math.floor(i / 16) * 16 + 8;
                    const worldX = x * 256 + px;
                    const worldY = y * 256 + py;
                    points.push(map.unproject([worldX, worldY], z));
                }
                const key = reliefLayer._tileCoordsToKey(event.coords);
                tileRangeCache.set(key, { grid, points });
                updateViewRange();
            }
        };
        img.src = url;
    });

    map.on('overlayadd', (e) => {
        if (e.name === "Elevation") {
            legend.addTo(map);
            // Use a short delay to ensure layer state is settled
            setTimeout(() => updateViewRange(true), 50);
        }
    });

    map.on('overlayremove', (e) => {
        if (e.name === "Elevation") {
            legend.remove();
        }
    });

    map.on('movestart zoomstart', () => {
        if (map.hasLayer(reliefLayer)) {
            reliefLayer.setOpacity(0);
            legend.hide();
        }
    });

    map.on('moveend zoomend', () => updateViewRange());

    const overlays = { "Elevation": reliefLayer };
    L.control.layers(baseMaps, overlays, { position: "topleft" }).addTo(map);

    return map;
}

function createCustomPanes(map) {
    map.createPane('ornamentPane');
    map.getPane('ornamentPane').style.zIndex = 350;
    map.getPane('ornamentPane').style.pointerEvents = 'none';

    map.createPane('ornamentFrontPane');
    map.getPane('ornamentFrontPane').style.zIndex = 625;
    map.getPane('ornamentFrontPane').style.pointerEvents = 'none';

    map.createPane('targetPane');
    map.getPane('targetPane').style.zIndex = 630;
    map.getPane('targetPane').style.pointerEvents = 'none';

    map.createPane('shardPane');
    map.getPane('shardPane').style.zIndex = 640;
    map.getPane('shardPane').style.pointerEvents = 'none';
}
