import {
    fromString as zdtFromString,
    add as zdtAdd,
    toLocaleString as zdtToLocaleString,
} from "temporal-polyfill/fns/ZonedDateTime";
import { fromFields as durationFromFields } from "temporal-polyfill/fns/Duration";
import {
    fromEpochMilliseconds as instantFromEpochMilliseconds,
    toZonedDateTimeISO,
} from "temporal-polyfill/fns/Instant";
import { getBasic } from "temporal-polyfill/fns/Calendar";

export type ZonedDateTime = ReturnType<typeof zdtFromString>;

export interface ScheduledActionItem {
    action: string;
    time: ZonedDateTime;
}

export interface ShardActionSchedule {
    startTime: ZonedDateTime;
    waves: ScheduledActionItem[][];
}

export interface ShardMechanicBlueprint {
    waves: { startOffset: number }[];
    waveActions: { action: string; time: number }[];
}

export function calculateShardActionSchedule(
    shardMechanic: ShardMechanicBlueprint,
    siteGeocode: { date: string }
): ShardActionSchedule {
    const startTimeZoned = zdtFromString(siteGeocode.date, getBasic);
    const schedule: ShardActionSchedule = {
        startTime: startTimeZoned,
        waves: [],
    };

    for (const wave of shardMechanic.waves) {
        const waveStartTimeZoned = zdtAdd(
            startTimeZoned,
            durationFromFields({ minutes: wave.startOffset }),
        );

        const waveSchedule: ScheduledActionItem[] = [];
        for (const waveAction of shardMechanic.waveActions.filter(a =>
            ["spawn", "jump", "despawn"].includes(a.action),
        )) {
            const waveActionTimeZoned = zdtAdd(
                waveStartTimeZoned,
                durationFromFields({ minutes: waveAction.time }),
            );
            waveSchedule.push({
                action: waveAction.action,
                time: waveActionTimeZoned,
            });
        }
        schedule.waves.push(waveSchedule);
    }
    return schedule;
}

export function convertToCsv(data: Record<string, unknown>[]): string {
    if (!data || data.length === 0) return "";
    const headers = Object.keys(data[0]!);
    const lines = [headers.join(",")];
    for (const row of data) {
        const line = headers.map(header => {
            const val = row[header] !== undefined && row[header] !== null ? String(row[header]) : "";
            const shouldQuote = header.includes("Origin") ||
                                header.includes("Destination") ||
                                header.includes("Portal") ||
                                val.includes(",") ||
                                val.includes('"') ||
                                val.includes("\n");
            if (shouldQuote) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        lines.push(line.join(","));
    }
    return lines.join("\n");
}

export function formatZonedDateTimeWithMs(zdt?: ZonedDateTime): string {
    if (!zdt) return "-";
    return zdtToLocaleString(zdt, "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hourCycle: "h23",
    });
}

export function formatTimeWithMs(epochMs: number | string | undefined, timezone: string): string {
    if (!epochMs) return "-";
    const inst = instantFromEpochMilliseconds(Number(epochMs));
    const zdt = toZonedDateTimeISO(inst, timezone);
    return formatZonedDateTimeWithMs(zdt);
}

export function formatDurationMs(durationMs: number, showDecimals = true): string {
    const seconds = durationMs / 1000;
    const absSeconds = Math.abs(seconds);
    const minutes = Math.floor(absSeconds / 60);
    const remainingSeconds = absSeconds % 60;
    const formattedSeconds = showDecimals ? remainingSeconds.toFixed(1) : Math.round(remainingSeconds).toString();
    const sign = seconds < 0 ? "-" : "";
    return minutes > 0 ? `${sign}${minutes}m ${formattedSeconds}s` : `${sign}${formattedSeconds}s`;
}
