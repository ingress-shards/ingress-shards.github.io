import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diff as diffZonedDateTime } from "temporal-polyfill/fns/ZonedDateTime";
import eventBlueprints from "@ingress-shards/ingress-events-core/conf/event_blueprints.json";
import seasonManifest from "@ingress-shards/ingress-events-core/conf/season_manifest.json";
import seasonGeocode from "@ingress-shards/ingress-events-core/conf/season_geocode.json";
import {
    ConfigRegistry,
    toZonedDateTime,
    type EventBlueprints,
    type FactionId,
    type ObservedPortal,
    type SeasonGeocode,
    type SeasonManifest,
    type SiteConfig,
    type SiteState,
    type SiteStateMap,
} from "@ingress-shards/ingress-events-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const GEN_DATA_DIR = path.join(ROOT_DIR, "gen", "data");

interface SeasonPresentationConfig {
    badgeUrl: string;
    quarter: string;
    cardBorderClass: string;
    badgeBorderClass: string;
    titleClass: string;
    eventDescriptions: Record<string, string>;
}

const SEASON_PRESENTATION: Record<string, SeasonPresentationConfig> = {
    "2026-plusgamma": {
        badgeUrl: "https://ingress.plus/api/files/i37o5ykupb5voix/l8mi1sc9582nd6n/pgamma_season_gold_pwiam7m7cu.png?thumb=128x128",
        quarter: "Q1",
        cardBorderClass: "border-teal-500/25",
        badgeBorderClass: "border-teal-500/30",
        titleClass: "text-teal-400",
        eventDescriptions: {
            INVESTIGATION: "Contain shards in NL-1331 mobile research labs",
            ANOMALY: "13 shards, 3 jumps, 4 targets / 30m wave &bull; 100 season pts split by best wave",
        },
    },
    "2026-orion": {
        badgeUrl: "https://ingress.plus/api/files/i37o5ykupb5voix/ulq7sreqyfxr3gd/orion_gold_nygjszbipy.png?thumb=128x128",
        quarter: "Q2",
        cardBorderClass: "border-violet-500/25",
        badgeBorderClass: "border-violet-500/30",
        titleClass: "text-violet-400",
        eventDescriptions: {
            ANOMALY: "23 shards, 4 jumps, 6 targets / 30m wave &bull; 100 season pts split by best paired waves",
        },
    },
    "2026-apollo": {
        badgeUrl: "https://ingress.plus/api/files/i37o5ykupb5voix/va12fhe9y6mm4cy/apollo_gold_ygkz4mgn14.png?thumb=128x128",
        quarter: "Q3",
        cardBorderClass: "border-orange-500/25",
        badgeBorderClass: "border-orange-500/30",
        titleClass: "text-orange-400",
        eventDescriptions: {
            ANOMALY: "23 shards, 4 jumps, 6 targets / 30m wave &bull; 100 season pts split by best paired waves",
        },
    },
    "2026-cygnus": {
        badgeUrl: "https://ingress.plus/api/files/i37o5ykupb5voix/fpscpx321ciimjx/cygnus_gold_0ge0huks85.png?thumb=128x128",
        quarter: "Q4",
        cardBorderClass: "border-pink-500/25",
        badgeBorderClass: "border-pink-500/30",
        titleClass: "text-pink-400",
        eventDescriptions: {
            STORM: "3 shards per site &bull; 6 sets of 3 staggered jumps &bull; precise link lengths required",
        },
    },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
    INVESTIGATION: "Investigation",
    ANOMALY: "Anomaly",
    STORM: "Shard Storm",
    SKIRMISH: "Skirmish",
    SINGULAR: "Singular",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SiteFlagData {
    slug: string;
    countryCode: string;
    label: string;
    resScore: number;
    enlScore: number;
}

interface EventTypeSummary {
    eventType: string;
    label: string;
    description: string;
    sites: SiteFlagData[];
    shards: number;
    links: number;
    jumps: number;
    portals: number;
    totalDistMeters: number;
}

interface SeasonSummary {
    id: string;
    name: string;
    overviewUrl: string;
    presentation: SeasonPresentationConfig;
    resScore: number;
    enlScore: number;
    events: EventTypeSummary[];
}

interface MoveRecord {
    siteId: string;
    siteName: string;
    timeZone: string;
    align: FactionId;
    shardId: number;
    originTitle: string;
    originUrl: string;
    destTitle: string;
    destUrl: string;
    linkTime: number;
    moveTime: number;
    elapsedMs: number;
    distanceMeters: number;
    scored: boolean;
}

interface NearMissRecord extends MoveRecord {
    missMeters: number;
    boundLabel: string;
    boundMeters: number;
}

interface PortalMagnetStats {
    siteName: string;
    portalTitle: string;
    portalUrl: string;
    uniqueShards: Set<number>;
    departures: number;
    arrivals: number;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function formatNumber(value: number, decimals = 0): string {
    return value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function formatScore(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? formatNumber(rounded, 0) : formatNumber(rounded, 1);
}

function intelUrl(portal?: ObservedPortal): string {
    if (!portal) return "#";
    const lat = (portal.latE6 / 1e6).toFixed(6);
    const lng = (portal.lngE6 / 1e6).toFixed(6);
    return `https://intel.ingress.com/?pll=${lat},${lng}`;
}

function formatLocalTimestamp(epochMs: number, timeZone: string, options?: { includeYear?: boolean; includeMs?: boolean }): string {
    const zdt = toZonedDateTime(epochMs, timeZone);
    const mon = SHORT_MONTHS[zdt.month - 1] ?? "";
    const day = String(zdt.day).padStart(2, "0");
    const hh = String(zdt.hour).padStart(2, "0");
    const mm = String(zdt.minute).padStart(2, "0");
    const ss = String(zdt.second).padStart(2, "0");
    const datePart = options?.includeYear ? `${mon} ${day}, ${zdt.year}` : `${mon} ${day}`;
    const msPart = options?.includeMs ? `.${String(zdt.millisecond).padStart(3, "0")}` : "";
    return `${datePart} &bull; ${hh}:${mm}:${ss}${msPart}`;
}

function formatAgeDuration(fromMs: number, toMs: number, timeZone: string): string {
    const start = toZonedDateTime(fromMs, timeZone);
    const end = toZonedDateTime(toMs, timeZone);
    const diff = diffZonedDateTime(start, end, {
        largestUnit: "year",
        smallestUnit: "second",
    });
    return `${diff.years}y ${diff.months}m ${diff.days}d ${diff.hours}h ${diff.minutes}m ${diff.seconds}s`;
}

function formatSiteShortLabel(siteName: string): string {
    return siteName
        .replace(", Hiroshima Pref, Japan", ", Japan")
        .replace(", Telangana, India", ", India")
        .replace(", NSW, Australia", ", Australia")
        .replace(", New Jersey, USA", ", NJ, USA")
        .replace(", ON, Canada", ", Canada")
        .replace("Denver CO, USA", "Denver, CO, USA");
}

function getSiteScore(state: SiteState): { res: number; enl: number } {
    const seasonPoints = state.analysis?.seasonPointsResult?.points;
    if (seasonPoints) {
        return {
            res: seasonPoints.RES ?? 0,
            enl: seasonPoints.ENL ?? 0,
        };
    }

    let res = 0;
    let enl = 0;
    for (const wave of Object.values(state.analysis?.waves ?? {})) {
        res += wave.points?.total?.RES ?? 0;
        enl += wave.points?.total?.ENL ?? 0;
    }
    return { res, enl };
}

function renderFlags(seasonId: string, sites: SiteFlagData[]): string {
    const flagAnchor = (site: SiteFlagData): string => `
    <a href="https://ingress-shards.github.io/#/${seasonId}/${site.slug}" target="_blank" rel="noopener noreferrer" class="flag-link">
      <span class="fi fi-${site.countryCode.toLowerCase()}"></span>
      <span class="flag-tooltip"><strong class="text-white">${escapeHtml(site.label)}</strong><br><span class="text-res font-mono font-bold">RES ${formatScore(site.resScore)}</span> &bull; <span class="text-enl font-mono font-bold">ENL ${formatScore(site.enlScore)}</span></span>
    </a>`;

    if (sites.length === 9) {
        const topRow = sites.slice(0, 5).map(flagAnchor).join("");
        const bottomRow = sites.slice(5).map(flagAnchor).join("");
        return `
      <div class="flex flex-col items-center gap-1.5">
        <div class="flag-row-edge-left flex justify-center gap-1.5">${topRow}</div>
        <div class="flag-row-edge-left flex justify-center gap-1.5">${bottomRow}</div>
      </div>`;
    }

    const colsClass = sites.length === 6 ? "grid-cols-3" : "grid-cols-6 flag-grid-edge-right";
    return `<div class="grid ${colsClass} gap-1.5 w-fit mx-auto justify-items-center">${sites.map(flagAnchor).join("")}</div>`;
}

function renderStatRows(event: EventTypeSummary): string {
    const totalKm = Math.round(event.totalDistMeters / 1000);
    const avgMeters = event.jumps > 0 ? Math.round(event.totalDistMeters / event.jumps) : 0;
    const rows: [string, string][] = [
        ["Shards", formatNumber(event.shards)],
        ["Links", formatNumber(event.links)],
        ["Jumps", formatNumber(event.jumps)],
        ["Portals", formatNumber(event.portals)],
        ["Total Dist", `${formatNumber(totalKm)}km`],
        ["Avg Dist", `${formatNumber(avgMeters)} m/j`],
    ];

    const items = rows
        .map(
            ([label, value], index) => `
      <div class="flex justify-between items-baseline px-1.5 py-0.5 rounded${index % 2 === 0 ? " bg-white/[0.04]" : ""}">
        <span class="text-zinc-200">${label}</span>
        <strong class="font-mono">${value}</strong>
      </div>`,
        )
        .join("");

    return `<div class="pt-1.5 text-[11px] space-y-0.5">${items}</div>`;
}

function renderSeasonHeader(season: SeasonSummary): string {
    const { presentation } = season;
    return `
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0">
        <a href="${season.overviewUrl}" target="_blank" rel="noopener noreferrer" class="badge-link" title="View Season Overview">
          <img src="${presentation.badgeUrl}" alt="${escapeHtml(season.name)} Medal" crossorigin="anonymous" class="w-11 h-11 rounded-lg object-contain bg-black/20 p-0.5 border ${presentation.badgeBorderClass}" loading="lazy" />
        </a>
        <div class="min-w-0">
          <h3 class="text-base font-extrabold ${presentation.titleClass} leading-tight">
            <a href="${season.overviewUrl}" target="_blank" rel="noopener noreferrer" class="intel-link" title="View Season Overview">${escapeHtml(season.name)}</a>
          </h3>
          <span class="text-xs font-semibold text-[var(--muted-foreground)]">${presentation.quarter}</span>
        </div>
      </div>
      <div class="text-right font-mono text-xs font-bold leading-snug flex-shrink-0">
        <div class="text-res">RES ${formatScore(season.resScore)}</div>
        <div class="text-enl">ENL ${formatScore(season.enlScore)}</div>
      </div>
    </div>`;
}

function renderMovePortalLinks(originTitle: string, originUrl: string, destTitle: string, destUrl: string): string {
    const orig = escapeHtml(originTitle);
    const dest = escapeHtml(destTitle);
    return `
      <div class="space-y-0.5">
        <div class="truncate pb-0.5"><span class="text-[var(--muted-foreground)]">From:</span> <a href="${originUrl}" target="_blank" rel="noopener noreferrer" class="intel-link" title="${orig} — Click to open in Intel Map">${orig}</a></div>
        <div class="truncate pb-0.5"><span class="text-[var(--muted-foreground)]">To:</span> <a href="${destUrl}" target="_blank" rel="noopener noreferrer" class="intel-link" title="${dest} — Click to open in Intel Map">${dest}</a></div>
      </div>`;
}

function buildYearReview(year: number): string {
    const registry = new ConfigRegistry(
        eventBlueprints as EventBlueprints,
        seasonManifest as SeasonManifest,
        seasonGeocode as SeasonGeocode,
    );

    const seasonsMeta = (seasonManifest as SeasonManifest).seasons.filter((s) => s.year === year);
    if (seasonsMeta.length === 0) {
        throw new Error(`No seasons found in season_manifest.json for year ${year}`);
    }

    let totalRes = 0;
    let totalEnl = 0;
    let totalSites = 0;
    const countries = new Set<string>();
    let totalShards = 0;
    let movingShards = 0;
    let totalMovesAll = 0;
    let totalScoredMoves = 0;
    let totalScoredDistMeters = 0;
    let totalOrnamentedPortals = 0;
    let totalActivePortals = 0;

    const allScoredMoves: MoveRecord[] = [];
    const nearMissCandidates: NearMissRecord[] = [];
    const portalMagnets = new Map<string, PortalMagnetStats>();
    const seasonSummaries: SeasonSummary[] = [];

    for (const seasonMeta of seasonsMeta) {
        const presentation = SEASON_PRESENTATION[seasonMeta.id];
        if (!presentation) {
            throw new Error(`Missing presentation config for season ${seasonMeta.id}`);
        }

        const dataPath = path.join(GEN_DATA_DIR, `${seasonMeta.id}.json`);
        if (!existsSync(dataPath)) {
            throw new Error(`Missing generated season data at ${dataPath}. Run "npm run prepare:data" first.`);
        }

        const siteStates = JSON.parse(readFileSync(dataPath, "utf-8")) as SiteStateMap;
        const siteConfigs = registry.getSitesForSeason(seasonMeta.id);
        const siteConfigById = new Map<string, SiteConfig>(siteConfigs.map((c) => [c.geocode.id, c]));

        const eventBuckets = new Map<string, EventTypeSummary>();
        let seasonRes = 0;
        let seasonEnl = 0;

        for (const siteConfig of siteConfigs) {
            const siteId = siteConfig.geocode.id;
            const state = siteStates[siteId];
            if (!state) continue;

            totalSites += 1;
            countries.add(siteConfig.geocode.countryCode);

            const { res, enl } = getSiteScore(state);
            seasonRes += res;
            seasonEnl += enl;

            const eventType = siteConfig.geocode.eventType;
            let bucket = eventBuckets.get(eventType);
            if (!bucket) {
                bucket = {
                    eventType,
                    label: EVENT_TYPE_LABELS[eventType] ?? eventType,
                    description: presentation.eventDescriptions[eventType] ?? "",
                    sites: [],
                    shards: 0,
                    links: 0,
                    jumps: 0,
                    portals: 0,
                    totalDistMeters: 0,
                };
                eventBuckets.set(eventType, bucket);
            }

            const slug = siteId.replace(`${seasonMeta.id}-`, "");
            const shortSiteName = formatSiteShortLabel(siteConfig.geocode.name);
            bucket.sites.push({
                slug,
                countryCode: siteConfig.geocode.countryCode,
                label: shortSiteName,
                resScore: res,
                enlScore: enl,
            });

            const portals = state.telemetry?.portals ?? {};
            const shards = state.telemetry?.shards ?? {};
            const activePortalIds = new Set<number>();

            for (const shard of Object.values(shards)) {
                for (const h of shard.history) {
                    activePortalIds.add(h.portalId);
                    if (h.dest !== undefined) activePortalIds.add(h.dest);
                }
            }

            const waveStatsList = Object.values(state.analysis?.waves ?? {});
            const hasWaveShardStats = waveStatsList.some((w) => w.statistics?.shards !== undefined);
            if (hasWaveShardStats) {
                for (const wave of waveStatsList) {
                    const ws = wave.statistics?.shards;
                    if (!ws) continue;
                    const waveTotal = ws.moving + ws.nonMoving;
                    bucket.shards += waveTotal;
                    totalShards += waveTotal;
                    movingShards += ws.moving;
                }
            } else {
                for (const shard of Object.values(shards)) {
                    bucket.shards += 1;
                    totalShards += 1;
                    if (shard.history.some((h) => h.action === "link" || h.action === "jump")) {
                        movingShards += 1;
                    }
                }
            }

            bucket.portals += activePortalIds.size;
            totalActivePortals += activePortalIds.size;
            totalOrnamentedPortals += Object.keys(portals).length;

            for (const shardPath of Object.values(state.analysis?.shardPaths ?? {})) {
                for (const link of shardPath.links) {
                    let linkHasScoredMove = false;
                    for (const move of link.moves) {
                        totalMovesAll += 1;
                        const isScored = (move.scoredRules?.length ?? 0) > 0;
                        const originPortal = portals[move.origin];
                        const destPortal = portals[move.dest];
                        const originTitle = originPortal?.title ?? `Portal ${move.origin}`;
                        const destTitle = destPortal?.title ?? `Portal ${move.dest}`;
                        const origUrl = intelUrl(originPortal);
                        const destUrl = intelUrl(destPortal);
                        const align = (link.align === "RES" || link.align === "ENL" ? link.align : "RES") as FactionId;

                        const record: MoveRecord = {
                            siteId,
                            siteName: shortSiteName,
                            timeZone: siteConfig.geocode.timeZone,
                            align,
                            shardId: move.shardId,
                            originTitle,
                            originUrl: origUrl,
                            destTitle,
                            destUrl,
                            linkTime: link.linkTime,
                            moveTime: move.moveTime,
                            elapsedMs: move.moveTime - link.linkTime,
                            distanceMeters: shardPath.distance,
                            scored: isScored,
                        };

                        if (isScored) {
                            linkHasScoredMove = true;
                            bucket.jumps += 1;
                            bucket.totalDistMeters += shardPath.distance;
                            totalScoredMoves += 1;
                            totalScoredDistMeters += shardPath.distance;
                            allScoredMoves.push(record);
                        } else if (eventType === "STORM") {
                            const d = shardPath.distance;
                            let miss: { label: string; bound: number; diff: number } | undefined;
                            if (d < 1000) {
                                miss = { label: "Floor", bound: 1000, diff: 1000 - d };
                            } else if (d > 5000 && d < 6000) {
                                miss = { label: "Ceiling", bound: 5000, diff: d - 5000 };
                            } else if (d > 8000 && d < 10000) {
                                miss = { label: "Floor", bound: 10000, diff: 10000 - d };
                            }
                            if (miss && miss.diff < 250) {
                                nearMissCandidates.push({
                                    ...record,
                                    missMeters: miss.diff,
                                    boundLabel: miss.label,
                                    boundMeters: miss.bound,
                                });
                            }
                        }

                        const origKey = `${siteId}:${move.origin}`;
                        let origStats = portalMagnets.get(origKey);
                        if (!origStats) {
                            origStats = {
                                siteName: shortSiteName,
                                portalTitle: originTitle,
                                portalUrl: origUrl,
                                uniqueShards: new Set<number>(),
                                departures: 0,
                                arrivals: 0,
                            };
                            portalMagnets.set(origKey, origStats);
                        }
                        origStats.uniqueShards.add(move.shardId);
                        origStats.departures += 1;

                        const destKey = `${siteId}:${move.dest}`;
                        let destStats = portalMagnets.get(destKey);
                        if (!destStats) {
                            destStats = {
                                siteName: shortSiteName,
                                portalTitle: destTitle,
                                portalUrl: destUrl,
                                uniqueShards: new Set<number>(),
                                departures: 0,
                                arrivals: 0,
                            };
                            portalMagnets.set(destKey, destStats);
                        }
                        destStats.uniqueShards.add(move.shardId);
                        destStats.arrivals += 1;
                    }
                    if (linkHasScoredMove) {
                        bucket.links += 1;
                    }
                }
            }
        }

        // Order Investigation before Anomaly for +Gamma
        const orderedEvents = Array.from(eventBuckets.values()).sort((a, b) => {
            if (a.eventType === "INVESTIGATION") return -1;
            if (b.eventType === "INVESTIGATION") return 1;
            return 0;
        });

        totalRes += seasonRes;
        totalEnl += seasonEnl;

        seasonSummaries.push({
            id: seasonMeta.id,
            name: seasonMeta.name,
            overviewUrl: seasonMeta.overviewUrl,
            presentation,
            resScore: seasonRes,
            enlScore: seasonEnl,
            events: orderedEvents,
        });
        void siteConfigById;
    }

    const totalCombinedScore = totalRes + totalEnl;
    const resPct = totalCombinedScore > 0 ? ((totalRes / totalCombinedScore) * 100).toFixed(1) : "0.0";
    const enlPct = totalCombinedScore > 0 ? ((totalEnl / totalCombinedScore) * 100).toFixed(1) : "0.0";
    const movedPct = totalShards > 0 ? ((movingShards / totalShards) * 100).toFixed(1) : "0.0";
    const scoredPct = totalMovesAll > 0 ? ((totalScoredMoves / totalMovesAll) * 100).toFixed(1) : "0.0";
    const totalKmYear = Math.round(totalScoredDistMeters / 1000);
    const avgMetersYear = totalScoredMoves > 0 ? Math.round(totalScoredDistMeters / totalScoredMoves) : 0;

    const topSnipes = [...allScoredMoves].sort((a, b) => a.elapsedMs - b.elapsedMs).slice(0, 3);
    const topAncient = [...allScoredMoves].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 3);
    const topNearMisses = [...nearMissCandidates].sort((a, b) => a.missMeters - b.missMeters).slice(0, 3);
    const furthestJump = [...allScoredMoves].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];
    const shortestJump = [...allScoredMoves].sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
    const topMagnets = Array.from(portalMagnets.values())
        .sort((a, b) => b.uniqueShards.size - a.uniqueShards.size || (b.departures + b.arrivals) - (a.departures + a.arrivals))
        .slice(0, 2);

    const seasonCardsHtml = seasonSummaries
        .map((season) => {
            const isMultiEvent = season.events.length > 1;
            const innerEventsHtml = season.events
                .map(
                    (ev) => `
          <div class="p-2 rounded-lg bg-[var(--background)] border border-[var(--border)] flex flex-col justify-between${isMultiEvent ? "" : " flex-1"}">
            <div class="space-y-1 sm:min-h-[3.25rem]">
              <span class="text-xs font-bold ${season.presentation.titleClass} uppercase tracking-wide block text-center">${escapeHtml(ev.label)}</span>
              <p class="text-[11px] leading-snug text-[var(--muted-foreground)]">${ev.description}</p>
            </div>
            <div class="my-auto py-1.5">
              ${renderFlags(season.id, ev.sites)}
            </div>
            <div>
              ${renderStatRows(ev)}
            </div>
          </div>`,
                )
                .join("");

            const bodyHtml = isMultiEvent
                ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1">${innerEventsHtml}</div>`
                : innerEventsHtml;

            return `
        <div class="p-2.5 rounded-xl bg-[var(--card)] border ${season.presentation.cardBorderClass} flex flex-col space-y-2.5 shadow-sm">
          ${renderSeasonHeader(season)}
          ${bodyHtml}
        </div>`;
        })
        .join("");

    const snipesHtml = topSnipes
        .map(
            (m, i) => `
            <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
              <div class="space-y-1.5 min-w-0 flex-1">
                <div class="font-bold font-mono text-sm ${m.align === "RES" ? "text-res" : "text-enl"}">#${i + 1} &bull; ${(m.elapsedMs / 1000).toFixed(3)}s</div>
                ${renderMovePortalLinks(m.originTitle, m.originUrl, m.destTitle, m.destUrl)}
              </div>
              <div class="text-right flex-shrink-0 space-y-0.5">
                <div class="font-bold text-white text-sm leading-tight">${escapeHtml(m.siteName)}</div>
                <div class="text-[11px] text-[var(--muted-foreground)]">Shard ${m.shardId}</div>
                <div class="font-mono text-[11px] text-[var(--muted-foreground)]">Linked: ${formatLocalTimestamp(m.linkTime, m.timeZone, { includeMs: true })}</div>
                <div class="font-mono text-[11px] text-[var(--muted-foreground)]">Jumped: ${formatLocalTimestamp(m.moveTime, m.timeZone, { includeMs: true })}</div>
              </div>
            </div>`,
        )
        .join("");

    const ancientHtml = topAncient
        .map(
            (m, i) => `
            <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
              <div class="space-y-1.5 min-w-0 flex-1">
                <div class="font-bold font-mono text-sm ${m.align === "RES" ? "text-res" : "text-enl"}">#${i + 1} &bull; ${formatAgeDuration(m.linkTime, m.moveTime, m.timeZone)}</div>
                ${renderMovePortalLinks(m.originTitle, m.originUrl, m.destTitle, m.destUrl)}
              </div>
              <div class="text-right flex-shrink-0 space-y-0.5">
                <div class="font-bold text-white text-sm leading-tight">${escapeHtml(m.siteName)}</div>
                <div class="text-[11px] text-[var(--muted-foreground)]">Shard ${m.shardId}</div>
                <div class="font-mono text-[11px] text-[var(--muted-foreground)]">Linked: ${formatLocalTimestamp(m.linkTime, m.timeZone, { includeYear: true })}</div>
                <div class="font-mono text-[11px] text-[var(--muted-foreground)]">Jumped: ${formatLocalTimestamp(m.moveTime, m.timeZone, { includeYear: true })}</div>
              </div>
            </div>`,
        )
        .join("");

    const nearMissesHtml = topNearMisses
        .map(
            (m, i) => `
        <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
          <div class="space-y-1.5 min-w-0 flex-1">
            <div class="font-bold font-mono text-sm ${m.align === "RES" ? "text-res" : "text-enl"}">#${i + 1} &bull; ${m.missMeters.toFixed(2)}m</div>
            ${renderMovePortalLinks(m.originTitle, m.originUrl, m.destTitle, m.destUrl)}
          </div>
          <div class="text-right flex-shrink-0 space-y-0.5">
            <div class="font-bold text-white text-sm leading-tight">${escapeHtml(m.siteName)}</div>
            <div class="text-[11px] text-[var(--muted-foreground)]">Shard ${m.shardId}</div>
            <div class="font-mono text-[11px] text-[var(--muted-foreground)]">Link Length: ${formatNumber(m.distanceMeters, 2)}m</div>
            <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${m.boundLabel}: ${formatNumber(m.boundMeters)}m</div>
            <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${formatLocalTimestamp(m.moveTime, m.timeZone)}</div>
          </div>
        </div>`,
        )
        .join("");

    const furthestHtml = furthestJump
        ? `
          <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
            <div class="space-y-1.5 min-w-0 flex-1">
              <div class="font-bold font-mono text-sm ${furthestJump.align === "RES" ? "text-res" : "text-enl"}">Furthest &bull; ${(furthestJump.distanceMeters / 1000).toFixed(2)}km</div>
              ${renderMovePortalLinks(furthestJump.originTitle, furthestJump.originUrl, furthestJump.destTitle, furthestJump.destUrl)}
            </div>
            <div class="text-right flex-shrink-0 space-y-0.5">
              <div class="font-bold text-white text-sm leading-tight">${escapeHtml(furthestJump.siteName)}</div>
              <div class="text-[11px] text-[var(--muted-foreground)]">Shard ${furthestJump.shardId}</div>
              <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${formatLocalTimestamp(furthestJump.moveTime, furthestJump.timeZone)}</div>
            </div>
          </div>`
        : "";

    const shortestHtml = shortestJump
        ? `
          <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
            <div class="space-y-1.5 min-w-0 flex-1">
              <div class="font-bold font-mono text-sm ${shortestJump.align === "RES" ? "text-res" : "text-enl"}">Shortest &bull; ${shortestJump.distanceMeters.toFixed(2)}m</div>
              ${renderMovePortalLinks(shortestJump.originTitle, shortestJump.originUrl, shortestJump.destTitle, shortestJump.destUrl)}
            </div>
            <div class="text-right flex-shrink-0 space-y-0.5">
              <div class="font-bold text-white text-sm leading-tight">${escapeHtml(shortestJump.siteName)}</div>
              <div class="text-[11px] text-[var(--muted-foreground)]">Shard ${shortestJump.shardId}</div>
              <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${formatLocalTimestamp(shortestJump.moveTime, shortestJump.timeZone)}</div>
            </div>
          </div>`
        : "";

    const magnetsHtml = topMagnets
        .map((p, i) => {
            const totalMoves = p.departures + p.arrivals;
            const title = escapeHtml(p.portalTitle);
            return `
          <div class="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs flex justify-between items-start gap-3">
            <div class="space-y-1.5 min-w-0 flex-1">
              <div class="font-bold font-mono text-sm text-fuchsia-300">#${i + 1} &bull; ${p.uniqueShards.size} shards (${totalMoves} moves)</div>
              <div class="truncate pb-0.5"><span class="text-[var(--muted-foreground)]">Portal:</span> <a href="${p.portalUrl}" target="_blank" rel="noopener noreferrer" class="intel-link" title="${title} — Click to open in Intel Map">${title}</a></div>
            </div>
            <div class="text-right flex-shrink-0 space-y-0.5">
              <div class="font-bold text-white text-sm leading-tight">${escapeHtml(p.siteName)}</div>
              <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${p.departures} departures</div>
              <div class="font-mono text-[11px] text-[var(--muted-foreground)]">${p.arrivals} arrivals</div>
            </div>
          </div>`;
        })
        .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ingress Shards: ${year} Review</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/css/flag-icons.min.css" crossorigin="anonymous" />
  <style>
    /* Strict Faction Palette: Blue and Green are PURELY reserved for RES & ENL */
    :root {
      --res-base: #0088FF;
      --res-soft: #38bdf8;
      --res-bg: rgba(0, 136, 255, 0.12);
      --res-border: rgba(0, 136, 255, 0.35);

      --enl-base: #03DC03;
      --enl-soft: #4ade80;
      --enl-bg: rgba(3, 220, 3, 0.12);
      --enl-border: rgba(3, 220, 3, 0.35);

      --background: #111113;
      --card: #1c1c20;
      --foreground: #f4f4f5;
      --muted-foreground: #b8c0cc;
      --border: rgba(255, 255, 255, 0.16);
    }

    .text-enl { color: var(--enl-soft); }
    .text-res { color: var(--res-soft); }
    .bg-enl-soft { background-color: var(--enl-bg); }
    .bg-res-soft { background-color: var(--res-bg); }
    .border-enl { border-color: var(--enl-border); }
    .border-res { border-color: var(--res-border); }

    /* Unified Subtle Dotted Link Styling (No Arrow) */
    .intel-link {
      color: inherit;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
      transition: color 0.15s ease, text-decoration-color 0.15s ease;
    }
    .intel-link:hover {
      color: #fbbf24;
      text-decoration-color: #fbbf24;
    }

    .badge-link {
      display: inline-flex;
      flex-shrink: 0;
      border-radius: 0.5rem;
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    .badge-link:hover {
      transform: scale(1.06);
      filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.35));
    }

    /* Pill-less Flag Link with Subtle Hover Scale & Custom Blue/Green Tooltip */
    .flag-link {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    .flag-link:hover {
      transform: translateY(-1px) scale(1.1);
      filter: drop-shadow(0 2px 6px rgba(251, 191, 36, 0.4));
    }
    .flag-link .fi {
      border-radius: 3px;
      width: 1.55em;
      height: 1.16em;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    }
    .flag-tooltip {
      pointer-events: none;
      opacity: 0;
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      z-index: 30;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 0.5rem;
      padding: 0.35rem 0.55rem;
      font-size: 11px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
      transition: opacity 0.12s ease;
    }
    .flag-link:hover .flag-tooltip,
    .flag-link:focus-visible .flag-tooltip {
      opacity: 1;
    }
    .flag-row-edge-left > .flag-link:first-child .flag-tooltip {
      left: 0;
      transform: none;
    }
    .flag-grid-edge-right > .flag-link:nth-child(6n) .flag-tooltip {
      left: auto;
      right: 0;
      transform: none;
    }
  </style>
</head>
<body class="bg-[var(--background)] text-[var(--foreground)] antialiased p-4 md:p-6 min-h-screen">
  <div class="max-w-7xl mx-auto space-y-5">

    <!-- Header Section with Radar Icon, Title, Attribution & High-Contrast Faction Pills -->
    <header class="relative overflow-hidden rounded-2xl bg-[var(--card)] border border-[var(--border)] p-5 md:p-6 shadow-sm">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="flex-shrink-0 p-3 rounded-2xl bg-[#ff7700]/10 border border-[#ff7700]/30 shadow-inner">
            <svg class="w-11 h-11 md:w-12 md:h-12" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="14" stroke="#ff7700" stroke-width="1.5" fill="rgba(255,119,0,0.06)"/>
              <path d="M16 2v3.5M16 26.5V30M2 16h3.5M26.5 16H30" stroke="#ff7700" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="16" cy="16" r="2.2" fill="#ff7700"/>
              <path d="M16 16l11.2-8.4A14 14 0 0 0 16 2z" fill="rgba(255,119,0,0.3)"/>
              <path d="M16 16l11.2-8.4" stroke="#ff7700" stroke-width="1.5" stroke-linecap="round"/>
              <polygon points="7.2,7.2 14.4,7.2 11.6,10.1" fill="#ff7700"/>
              <polygon points="6.7,7.8 11.2,10.9 10.3,15.0" fill="#ff7700"/>
              <polygon points="14.8,7.8 12.1,10.9 11.1,15.0" fill="#ff7700"/>
              <path d="M17.4 19.3h7.8v4.4h-2.7l-1.2 2.1-1.2-2.1h-2.7z" stroke="#ff7700" stroke-width="0.9" stroke-linejoin="round"/>
              <rect x="18.4" y="20.3" width="2.4" height="2.4" rx="0.3" fill="#ff7700"/>
              <rect x="21.8" y="20.3" width="2.4" height="2.4" rx="0.3" fill="#ff7700"/>
              <polygon points="9.5,18.5 12.1,20 12.1,23 9.5,24.5 6.9,23 6.9,20" stroke="#ff7700" stroke-width="0.9" stroke-linejoin="round"/>
            </svg>
          </div>
          <div>
            <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight">
              <span class="inline-block text-transparent bg-clip-text" style="background-image: linear-gradient(90deg, #22d3ee 0%, #a78bfa 35%, #f472b6 70%, #fbbf24 100%);">Ingress Shards: ${year} Review</span>
            </h1>
            <p class="text-xs text-[var(--muted-foreground)] mt-1">
              Data provided by <a href="https://ingress-shards.github.io/" target="_blank" rel="noopener noreferrer" class="intel-link text-amber-400">ingress-shards.github.io</a>.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 self-start sm:self-auto">
          <div class="px-3.5 py-2 rounded-xl bg-res-soft border border-res">
            <div class="text-[11px] font-extrabold text-res tracking-wider uppercase">Resistance</div>
            <div class="text-xl font-black text-[var(--foreground)] leading-tight font-mono">
              ${formatScore(totalRes)} <span class="text-xs font-bold text-res">${resPct}%</span>
            </div>
          </div>
          <div class="px-3.5 py-2 rounded-xl bg-enl-soft border border-enl">
            <div class="text-[11px] font-extrabold text-enl tracking-wider uppercase">Enlightened</div>
            <div class="text-xl font-black text-[var(--foreground)] leading-tight font-mono">
              ${formatScore(totalEnl)} <span class="text-xs font-bold text-enl">${enlPct}%</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Annual Stats -->
    <section>
      <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 md:p-3.5 shadow-sm">
        <div class="grid grid-cols-2 md:grid-cols-4 text-center">
          <div class="py-2 md:py-1 px-3 border-b border-r md:border-b-0 border-[var(--border)]">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-purple-400 block">Global Footprint</span>
            <div class="mt-0.5 flex items-baseline justify-center gap-1.5 flex-wrap">
              <span class="text-xl font-black text-[var(--foreground)]">${formatNumber(totalSites)} Sites</span>
              <span class="text-xs font-medium text-[var(--muted-foreground)]">(${formatNumber(countries.size)} Countries)</span>
            </div>
          </div>
          <div class="py-2 md:py-1 px-3 border-b md:border-b-0 md:border-r border-[var(--border)]">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 block">Shards Spawned</span>
            <div class="mt-0.5 flex items-baseline justify-center gap-1.5 flex-wrap">
              <span class="text-xl font-black text-[var(--foreground)]">${formatNumber(totalShards)}</span>
              <span class="text-xs font-medium text-[var(--muted-foreground)]">(${movedPct}% moved)</span>
            </div>
          </div>
          <div class="py-2 md:py-1 px-3 border-r border-[var(--border)]">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-amber-400 block">Link Jumps Recorded</span>
            <div class="mt-0.5 flex items-baseline justify-center gap-1.5 flex-wrap">
              <span class="text-xl font-black text-[var(--foreground)]">${formatNumber(totalMovesAll)}</span>
              <span class="text-xs font-medium text-[var(--muted-foreground)]">(${scoredPct}% scored)</span>
            </div>
          </div>
          <div class="py-2 md:py-1 px-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-rose-400 block">Ornamented Portals</span>
            <div class="mt-0.5 flex items-baseline justify-center gap-1.5 flex-wrap">
              <span class="text-xl font-black text-[var(--foreground)]">${formatNumber(totalOrnamentedPortals)}</span>
              <span class="text-xs font-medium text-[var(--muted-foreground)]">(${formatNumber(totalActivePortals)} active)</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Season Breakdown -->
    <section>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[calc(40%-10px)_repeat(3,minmax(0,1fr))] gap-3">
        ${seasonCardsHtml}
      </div>
    </section>

    <!-- Fastest Snipes & Ancient Corridors -->
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-[var(--card)] rounded-xl border border-amber-500/25 p-4 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold flex items-center gap-2 text-amber-400"><span>⚡</span> Fastest Link Snipes</h3>
          <span class="text-xs text-[var(--muted-foreground)]">Shortest elapsed link &rarr; jump</span>
        </div>
        <div class="space-y-2">${snipesHtml}</div>
      </div>

      <div class="bg-[var(--card)] rounded-xl border border-purple-500/25 p-4 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold flex items-center gap-2 text-purple-400"><span>🏛️</span> Ancient Corridors</h3>
          <span class="text-xs text-[var(--muted-foreground)]">Longest standing pre-existing links</span>
        </div>
        <div class="space-y-2">${ancientHtml}</div>
      </div>
    </section>

    <!-- The "Near Misses" -->
    <section class="bg-[var(--card)] rounded-xl border border-rose-500/25 p-4 space-y-3 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold flex items-center gap-2 text-rose-400"><span>💔</span> The "Near Misses"</h3>
        <span class="text-xs text-[var(--muted-foreground)]">Closest misses on link length targets</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">${nearMissesHtml}</div>
    </section>

    <!-- Distance Extremes & Shard Magnet -->
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-[var(--card)] p-4 rounded-xl border border-cyan-500/25 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold flex items-center gap-2 text-cyan-400"><span>📏</span> Jump Distance Extremes</h3>
          <span class="text-xs text-[var(--muted-foreground)]">${formatNumber(totalKmYear)}km Traveled in ${year} (Avg ${formatNumber(avgMetersYear)}m / jump)</span>
        </div>
        <div class="space-y-2">${furthestHtml}${shortestHtml}</div>
      </div>

      <div class="bg-[var(--card)] p-4 rounded-xl border border-fuchsia-500/25 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold flex items-center gap-2 text-fuchsia-400"><span>🧲</span> Shard Magnet</h3>
          <span class="text-xs text-[var(--muted-foreground)]">Most unique shards seen by a single portal</span>
        </div>
        <div class="space-y-2">${magnetsHtml}</div>
      </div>
    </section>

    <footer class="text-center text-[11px] text-[var(--muted-foreground)] pt-1 pb-2">
      Data from <a href="https://ingress-shards.github.io/" target="_blank" rel="noopener noreferrer" class="intel-link text-amber-400">ingress-shards.github.io</a> &bull; Timestamps in local time
    </footer>
  </div>
</body>
</html>
`;
}

function main(): void {
    const yearArg = process.argv.find((arg) => /^\d{4}$/.test(arg));
    const year = yearArg ? Number.parseInt(yearArg, 10) : 2026;
    const html = buildYearReview(year);
    const outDir = path.join(ROOT_DIR, "review", String(year));
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "index.html");
    writeFileSync(outPath, html, "utf-8");
    console.log(`Generated ${year} review at ${path.relative(ROOT_DIR, outPath)}`);
}

main();
