/**
 * Converts HSV (hue in degrees, saturation/value in [0, 1]) to 8-bit RGB.
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    if (!Number.isFinite(h)) return [0, 0, 0];
    let normalizedHue = h;
    while (normalizedHue < 0) normalizedHue += 360;
    while (normalizedHue >= 360) normalizedHue -= 360;

    const hDiv = normalizedHue / 60;
    const c = v * s;
    const x = c * (1 - Math.abs((hDiv % 2) - 1));
    const m = v - c;

    let r: number;
    let g: number;
    let b: number;
    if (hDiv < 1) [r, g, b] = [c, x, 0];
    else if (hDiv < 2) [r, g, b] = [x, c, 0];
    else if (hDiv < 3) [r, g, b] = [0, c, x];
    else if (hDiv < 4) [r, g, b] = [0, x, c];
    else if (hDiv < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

/**
 * Maps a normalized elevation ratio in [0, 1] to the hypsometric blue-to-red tint.
 */
export function elevationRatioToRgb(ratio: number): [number, number, number] {
    const clamped = Math.max(0, Math.min(1, ratio));
    const hue = 210 - clamped * 180;
    return hsvToRgb(hue, 1, 1);
}
