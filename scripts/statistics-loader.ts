import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEventConfigRegistry } from "../src/config/EventConfig.js";
import { calculateStatisticsForSeason, type BlueprintsConfig } from "./validation/Statistics.js";
import { convertToCsv } from "./validation/CsvHelpers.js";
import { adaptRecordForValidation } from "./validation/SiteAdapter.js";
import type { SiteRecord } from "@ingress-shards/ingress-events-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "gen", "data");
const REPORTS_DIR = path.join(__dirname, "..", "gen", "reports");

async function runStatistics(): Promise<void> {
    try {
        const startTime = performance.now();
        const registry = getEventConfigRegistry();
        const seasonIds = registry.getAllSeasonIds();

        console.log(`ℹ️ Calculating shard jump statistics across ${seasonIds.length} seasons...`);

        const allStats: Record<string, unknown>[] = [];

        for (const seasonId of seasonIds) {
            const seasonFilePath = path.join(DATA_DIR, `${seasonId}.json`);
            let records: Record<string, SiteRecord>;
            try {
                const content = await fs.readFile(seasonFilePath, "utf-8");
                records = JSON.parse(content);
            } catch {
                continue;
            }

            const seasonMetadata = registry.getSeasonMetadata(seasonId);
            const seriesConfig = {
                id: seasonId,
                components: seasonMetadata?.components?.map(c => ({
                    eventType: c.eventType,
                    startTime: c.startTime,
                    shardMechanics: c.mechanics?.shards?.shardMechanics,
                    targetMechanics: c.mechanics?.shards?.targetMechanics,
                    ...(c.schedule && { schedule: c.schedule }),
                })),
            };

            const adaptedSites = Object.values(records).map(r => adaptRecordForValidation(r, registry));
            const seasonStats = calculateStatisticsForSeason(adaptedSites, seriesConfig, registry.blueprints as unknown as BlueprintsConfig);
            if (seasonStats && seasonStats.length > 0) {
                allStats.push(...seasonStats);
            }
        }

        await fs.mkdir(REPORTS_DIR, { recursive: true });
        const reportPath = path.join(REPORTS_DIR, "site-statistics.csv");
        await fs.writeFile(reportPath, convertToCsv(allStats), "utf-8");

        const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Statistics calculation complete and report written to ${reportPath} in ${durationSec} seconds.`);
    } catch (error) {
        console.error("❌ Error calculating statistics:", error);
        process.exit(1);
    }
}

runStatistics();
