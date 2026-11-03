import {
    fromString as zdtFromString,
    withFields as zdtWithFields,
    withTimeZone as zdtWithTimeZone,
    compare as zdtCompare,
    diff as zdtDiff,
    add as zdtAdd,
    toLocaleString as zdtToLocaleString,
    toPlainDateTime as zdtToPlainDateTime,
} from "temporal-polyfill/fns/ZonedDateTime";
import {
    fromEpochMilliseconds as instantFromEpochMilliseconds,
    toZonedDateTimeISO as instantToZonedDateTimeISO,
} from "temporal-polyfill/fns/Instant";
import {
    toString as pdtToString,
} from "temporal-polyfill/fns/PlainDateTime";
import { zonedDateTimeISO } from "temporal-polyfill/fns/Now";
import { fromFields as durationFromFields } from "temporal-polyfill/fns/Duration";
import { getBasic } from "temporal-polyfill/fns/Calendar";

// Default locale using browser language preferences, falling back to en-GB.
export function getDefaultLocale() {
    return typeof navigator !== 'undefined'
        ? (navigator.language || 'en-GB')
        : 'en-GB';
}

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
    const inst = instantFromEpochMilliseconds(Number(epochTimeMs));
    const pdt = zdtToPlainDateTime(instantToZonedDateTimeISO(inst, 'UTC'));
    return pdtToString(pdt, { smallestUnit: 'seconds', fractionalSecondDigits: 0 });
}

/**
 * Formats the serialized ISO 8601 string (YYYY-MM-DDTHH:mm:ss) into a locale-specific short date string (e.g., 3/15/2023).
 */
export function formatIsoToShortDate(isoString, timeZone, locale = getDefaultLocale()) {
    const zdt = zdtFromString(isoString, getBasic);
    const targetZdt = timeZone ? zdtWithTimeZone(zdt, timeZone) : zdt;
    return zdtToLocaleString(targetZdt, locale, { dateStyle: 'short' });
}

/**
 * Formats an epoch time for local display time.
 */
export function formatEpochToLocalTime(epochMs, timeZone, locale = getDefaultLocale()) {
    const inst = instantFromEpochMilliseconds(Number(epochMs));
    const tz = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
    const zdt = instantToZonedDateTimeISO(inst, tz);
    return zdtToLocaleString(zdt, locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    });
}

/**
 * Formats an epoch time for local date and time display.
 */
export function formatEpochToLocalDateTime(epochMs, timeZone, locale = getDefaultLocale()) {
    const inst = instantFromEpochMilliseconds(Number(epochMs));
    const tz = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
    const zdt = instantToZonedDateTimeISO(inst, tz);
    return zdtToLocaleString(zdt, locale, {
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
 * Creates a ZonedDateTime object for a wave's start or end time, preserving the timezone of the original site event.
 * It correctly combines the date from the event's ISO string with a new time string.
 * @param {string} siteDateIso - The original ISO 8601 date string for the site (e.g., "2025-11-15T14:00:00+01:00").
 * @param {string} siteTimezone - The IANA timezone name for the site (e.g., "Europe/Amsterdam").
 * @param {string} timeStr - The time string for the wave (e.g., "14:02").
 * @returns {import('temporal-polyfill').ZonedDateTime} A ZonedDateTime object representing the precise start/end of the wave.
 */
export function createWaveDate(siteDateIso, siteTimezone, timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    const zdt = zdtFromString(siteDateIso, getBasic);
    const targetZdt = siteTimezone ? zdtWithTimeZone(zdt, siteTimezone) : zdt;
    return zdtWithFields(targetZdt, { hour, minute, second: 0, millisecond: 0 });
}

/**
 * Calculates the time remaining until a site starts and returns a formatted string.
 * - > 24 hours: "X days"
 * - < 24 hours: "X hours"
 * - < 60 minutes: "X minutes"
 * Returns null if the event has already started.
 */
export function getTimeRemaining(siteDateIso, siteTimezone) {
    const startTime = zdtFromString(siteDateIso, getBasic);
    const now = zonedDateTimeISO(siteTimezone);

    if (zdtCompare(startTime, now) <= 0) {
        return null;
    }

    const diff = zdtDiff(now, startTime, { largestUnit: 'days' });
    const totalDays = diff.days;
    const totalHours = diff.hours;
    const totalMinutes = diff.minutes;

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
    const startTime = zdtFromString(siteDateIso, getBasic);
    const endTime = zdtAdd(startTime, durationFromFields({ minutes: durationMins }));
    const now = zonedDateTimeISO(siteTimezone);

    if (zdtCompare(now, startTime) < 0 || zdtCompare(now, endTime) > 0) {
        return null;
    }

    const diff = zdtDiff(now, endTime, { largestUnit: 'hours' });
    const hours = Math.floor(diff.hours || 0);
    const minutes = Math.floor(diff.minutes || 0);

    const parts = [];
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

    return parts.join(' ');
}
