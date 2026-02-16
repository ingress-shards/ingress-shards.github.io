import { DateTime } from 'luxon';

// Default locale, safely checking for navigator object which only exists in browsers.
const DEFAULT_LOCALE = typeof navigator !== 'undefined' ? navigator.language : 'en-GB';

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
export function formatIsoToShortDate(isoString, timeZone, locale = DEFAULT_LOCALE) {
    const isoPart = isoString.split('[')[0];
    const dateObject = new Date(isoPart);
    return dateObject.toLocaleDateString(locale, { timeZone, dateStyle: 'short' });
}

/**
 * Formats an epoch time for local display time.
 */
export function formatEpochToLocalTime(epochMs, timeZone, locale = DEFAULT_LOCALE) {
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
export function formatEpochToLocalDateTime(epochMs, timeZone, locale = DEFAULT_LOCALE) {
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

/**
 * Creates a new Date object for a wave's start or end time, preserving the timezone of the original site event.
 * It correctly combines the date from the event's ISO string with a new time string.
 * @param {string} siteDateIso - The original ISO 8601 date string for the site (e.g., "2025-11-15T14:00:00+01:00").
 * @param {string} siteTimezone - The IANA timezone name for the site (e.g., "Europe/Amsterdam").
 * @param {string} timeStr - The time string for the wave (e.g., "14:02").
 * @returns {Date} A new Date object representing the precise start/end of the wave.
 */
export function createWaveDate(siteDateIso, siteTimezone, timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);

    // 1. Create a Luxon DateTime object from the ISO string, ensuring it's in the correct IANA timezone.
    const isoPart = siteDateIso.split('[')[0];
    const siteDateTime = DateTime.fromISO(isoPart, { zone: siteTimezone });

    // 2. Create a new DateTime by setting the desired time. Luxon handles all timezone and DST logic.
    const waveDateTime = siteDateTime.set({ hour, minute, second: 0, millisecond: 0 });

    // 3. Convert back to a native Date object for use in the rest of your application.
    return waveDateTime.toJSDate();
}

/**
 * Calculates the time remaining until a site starts and returns a formatted string.
 * - > 24 hours: "X days"
 * - < 24 hours: "X hours"
 * - < 60 minutes: "X minutes"
 * Returns null if the event has already started.
 */
export function getTimeRemaining(siteDateIso, siteTimezone) {
    const isoPart = siteDateIso.split('[')[0];
    const startTime = DateTime.fromISO(isoPart, { zone: siteTimezone });
    const now = DateTime.now().setZone(siteTimezone);

    if (startTime <= now) {
        return null;
    }

    const totalMinutes = startTime.diff(now, 'minutes').minutes;
    const totalHours = startTime.diff(now, 'hours').hours;
    const totalDays = startTime.diff(now, 'days').days;

    if (totalDays >= 1) {
        const days = Math.floor(totalDays);
        return `${days} day${days === 1 ? '' : 's'}`;
    }

    if (totalHours >= 1) {
        const hours = Math.floor(totalHours);
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }

    if (totalMinutes >= 1) {
        const minutes = Math.floor(totalMinutes);
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    return 'less than a minute';
}

/**
 * Calculates the remaining time for an active event.
 * @param {string} siteDateIso - The start date of the site.
 * @param {string} siteTimezone - The timezone of the site.
 * @param {number} durationMins - The total duration of the event in minutes.
 * @returns {string|null} Formatted string "X hours Y minutes" or null if not active.
 */
export function getActiveEventRemaining(siteDateIso, siteTimezone, durationMins) {
    const isoPart = siteDateIso.split('[')[0];
    const startTime = DateTime.fromISO(isoPart, { zone: siteTimezone });
    const endTime = startTime.plus({ minutes: durationMins });
    const now = DateTime.now().setZone(siteTimezone);

    if (now < startTime || now > endTime) {
        return null;
    }

    const diff = endTime.diff(now, ['hours', 'minutes']).toObject();
    const hours = Math.floor(diff.hours || 0);
    const minutes = Math.floor(diff.minutes || 0);

    const parts = [];
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

    return parts.join(' ');
}
