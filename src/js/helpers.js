export function reviveData(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => reviveData(item));
    }

    if (obj.__map__ === true && obj.data) {
        return new Map(obj.data);
    }

    const revivedObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            revivedObj[key] = reviveData(obj[key]);
        }
    }
    return revivedObj;
}

export function getSeriesSafeName(seriesName) {
    return seriesName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}
