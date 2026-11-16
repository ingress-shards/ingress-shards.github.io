import { toPlainDateTime as zdtToPlainDateTime } from "temporal-polyfill/fns/ZonedDateTime";
import {
    fromEpochMilliseconds as instantFromEpochMilliseconds,
    toZonedDateTimeISO as instantToZonedDateTimeISO,
} from "temporal-polyfill/fns/Instant";
import { toString as pdtToString } from "temporal-polyfill/fns/PlainDateTime";
import { MS_PER_DAY } from "@ingress-shards/ingress-events-core";

/**
 * Converts a 13-digit millisecond epoch time to a simplified ISO 8601 string,
 * suitable for serialization (YYYY-MM-DDTHH:mm:ss, without milliseconds or Z).
 * Retained until Phase 5e removes json-parser-worker.js.
 */
export function formatEpochToSerializationString(epochTimeMs) {
    const inst = instantFromEpochMilliseconds(Number(epochTimeMs));
    const pdt = zdtToPlainDateTime(instantToZonedDateTimeISO(inst, 'UTC'));
    return pdtToString(pdt, { smallestUnit: 'seconds', fractionalSecondDigits: 0 });
}

/**
 * Checks if a given timestamp is within 24 hours of a reference timestamp.
 * Retained until Phase 5e removes json-parser-worker.js.
 */
export function isWithin24Hours(targetTimeMs, referenceTimeMs) {
    return Math.abs(Number(targetTimeMs) - Number(referenceTimeMs)) <= MS_PER_DAY;
}
