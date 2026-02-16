/**
 * Decodes elevation from Terrarium-formatted RGB(A) values.
 */
export function decodeElevation(r, g, b, a = 255) {
    if (a < 255) return null;
    const h = (r * 256 + g + b / 256) - 32768;
    if (h > 8850 || h < -500) return null;
    return h;
}

/**
 * HSV to RGB conversion matching the leaflet-relief internal logic.
 */
export function hsvToRgb(h, s, v) {
    while (h < 0) h += 360;
    while (h > 360) h -= 360;
    const hDiv = h / 60;
    const c = v * s;
    const x = c * (1 - Math.abs((hDiv % 2) - 1));
    const m = v - c;
    let r, g, b;
    if (hDiv >= 0 && hDiv < 1) [r, g, b] = [c, x, 0];
    else if (hDiv >= 1 && hDiv < 2) [r, g, b] = [x, c, 0];
    else if (hDiv >= 2 && hDiv < 3) [r, g, b] = [0, c, x];
    else if (hDiv >= 3 && hDiv < 4) [r, g, b] = [0, x, c];
    else if (hDiv >= 4 && hDiv < 5) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Calculates hillshade intensity matching the Relief plugin's R() function.
 */
export function computeHillshadeIntensity(data, state) {
    const dzdx = (data[2] + 2 * data[5] + data[8] - (data[0] + 2 * data[3] + data[6])) / 40;
    const dzdy = (data[0] + 2 * data[1] + data[2] - (data[6] + 2 * data[7] + data[8])) / 40;
    let intensity = (state.hillshadeA1 - state.hillshadeA2 * dzdx - state.hillshadeA3 * dzdy) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
    intensity = Math.max(0, intensity);
    return Math.sqrt(intensity * 0.8 + 0.2);
}

/**
 * Samples a 16x16 grid of elevation values from a tile.
 */
export function getTileElevationGrid(tile, ctx) {
    ctx.drawImage(tile, 0, 0, 16, 16);
    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, 16, 16).data;
    } catch { return null; }

    const grid = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const idx = i * 4;
        const h = decodeElevation(imageData[idx], imageData[idx + 1], imageData[idx + 2], imageData[idx + 3]);
        grid[i] = h !== null ? h : -99999;
    }
    return grid;
}

const tileCache = new Map();

async function getTileData(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);

    const url = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        const img = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, 256, 256).data;
        tileCache.set(key, data);
        return data;
    } catch {
        return null;
    }
}

/**
 * Fetches elevation for a specific Lat/Lng by sampling Terrarium tiles.
 */
export async function getElevationForLatLng(lat, lng) {
    const z = 15;
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);

    const tileData = await getTileData(z, x, y);
    if (!tileData) return null;

    const px = Math.floor(((lng + 180) / 360 * n - x) * 256);
    const py = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - y) * 256);

    const idx = (py * 256 + px) * 4;
    return decodeElevation(tileData[idx], tileData[idx + 1], tileData[idx + 2], tileData[idx + 3]);
}
