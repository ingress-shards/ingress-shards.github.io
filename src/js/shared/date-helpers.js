const MS_PER_SECOND = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Converts a 13-digit millisecond epoch time string/number to a 10-digit
 * second epoch time string/number by truncating milliseconds. We only up to the second,
 * so the processed data doesn't need to store the ms.
 */
export function convertMsEpochToSecEpoch(epochMs) {
    // Math.trunc ensures we just drop the milliseconds, moving toward zero.
    return Math.trunc(Number(epochMs) / MS_PER_SECOND);
}

/**
 * Converts a 13-digit millisecond epoch time to a simplified ISO 8601 string,
 * suitable for serialization (YYYY-MM-DDTHH:mm:ss, without milliseconds or Z).
 * This is the standard format required for the geocode storage date field.
 */
export function formatEpochToSerializationString(epochTimeMs) {
    const dateObject = new Date(Number(epochTimeMs));
    return dateObject.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Formats the serialized ISO 8601 string (YYYY-MM-DDTHH:mm:ss) into a locale-specific short date string (e.g., 3/15/2023).
 */
export function formatSerializationToShortDate(isoString, timeZone, locale = navigator.language) {
    const dateObject = new Date(isoString);
    return dateObject.toLocaleDateString(locale, { timeZone, dateStyle: 'short' });
}

/**
 * Formats an epoch time for local display time.
 */
export function formatEpochToLocalTime(epochMs, timeZone, locale = navigator.language) {
    return new Date(Number(epochMs)).toLocaleTimeString(locale, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    });
}

/**
 * Formats an epoch time for local date and time display.
 */
export function formatEpochToLocalDateTime(epochMs, timeZone, locale = navigator.language) {
    return new Date(Number(epochMs)).toLocaleString(locale, {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Checks if a given timestamp is within 24 hours of a reference timestamp.
 */
export function isWithin24Hours(targetTimeMs, referenceTimeMs) {
    const target = Number(targetTimeMs);
    const reference = Number(referenceTimeMs);

    const differenceMs = Math.abs(target - reference);

    return differenceMs <= MS_PER_DAY;
}
