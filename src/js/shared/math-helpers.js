export function haversineDistance(coords1, coords2) {
    // Mean Earth Radius in meters
    const R = 6371000;
    const TO_RADIANS = Math.PI / 180;

    const lat1 = coords1.latitude;
    const lon1 = coords1.longitude;
    const lat2 = coords2.latitude;
    const lon2 = coords2.longitude;

    // Convert degrees to radians
    const dLat = (lat2 - lat1) * TO_RADIANS;
    const dLon = (lon2 - lon1) * TO_RADIANS;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * TO_RADIANS) * Math.cos(lat2 * TO_RADIANS) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c;

    return roundToDecimalPlaces(distance, 2);
}

export function roundToDecimalPlaces(num, decimals) {
    if (decimals <= 0) {
        return Math.round(num);
    }
    const powerOfTen = 10 ** decimals;
    return Math.round(num * powerOfTen) / powerOfTen;
}

export function truncateToDecimalPlaces(num, decimals) {
    if (decimals <= 0) {
        return Math.trunc(num);
    }
    const powerOfTen = 10 ** decimals;
    return Math.trunc(num * powerOfTen) / powerOfTen;
}
