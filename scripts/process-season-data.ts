import fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import eventBlueprints from "@ingress-shards/ingress-events-core/conf/event_blueprints.json";
import seasonManifest from "@ingress-shards/ingress-events-core/conf/season_manifest.json";
import seasonGeocode from "@ingress-shards/ingress-events-core/conf/season_geocode.json";
import {
    ConfigRegistry,
    DataIngestionPipeline,
    type SiteState,
    type SiteId,
    type SeasonId,
    type IngestionItem,
    type EventBlueprints,
    type SeasonManifest,
    type SeasonGeocode,
} from "@ingress-shards/ingress-events-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const DATA_DIR = path.join(ROOT_DIR, "data");
const SCRIPTS_DIR = path.join(ROOT_DIR, "scripts");
const GEN_DIR = path.join(ROOT_DIR, "gen");
const OUTPUT_DATA_DIR = path.join(GEN_DIR, "data");
const HASH_FILE = path.join(GEN_DIR, ".data_hash");
const CORE_DIST_FILE = path.join(ROOT_DIR, "node_modules", "@ingress-shards", "ingress-events-core", "dist", "index.mjs");

function computeFingerprint(): string {
    const hash = crypto.createHash("sha256");
    for (const dir of [DATA_DIR, SCRIPTS_DIR]) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
            if (entry.isFile()) {
                const fullPath = path.join(entry.parentPath ?? dir, entry.name);
                const stat = statSync(fullPath);
                hash.update(`${path.relative(ROOT_DIR, fullPath)}:${stat.size}:${stat.mtimeMs}`);
            }
        }
    }
    if (existsSync(CORE_DIST_FILE)) {
        hash.update(readFileSync(CORE_DIST_FILE));
    }
    return hash.digest("hex");
}

function hasValidArtifacts(): boolean {
    if (!existsSync(OUTPUT_DATA_DIR) || !existsSync(HASH_FILE)) {
        return false;
    }
    return readdirSync(OUTPUT_DATA_DIR).length > 0;
}

export class SeasonDataIngestor {
    constructor(private readonly registry: ConfigRegistry) {}

    public async ingestSeason(seasonId: SeasonId, seasonDir: string): Promise<Record<SiteId, SiteState>> {
        let files: string[] = [];
        try {
            files = await fs.readdir(seasonDir);
        } catch {
            return {};
        }

        const candidateSites = this.registry.getSitesForSeason(seasonId);
        const pipeline = new DataIngestionPipeline(this.registry, candidateSites);

        const items: IngestionItem[] = await Promise.all(
            files.map(async (filename) => ({
                filename,
                data: await fs.readFile(path.join(seasonDir, filename), "utf-8"),
            }))
        );

        const siteStates = await pipeline.ingestBatch(items);
        return Object.fromEntries(siteStates.map((s) => [s.metadata.siteId, s]));
    }
}

async function run(): Promise<void> {
    const isForce = process.argv.includes("--force");
    const currentFingerprint = computeFingerprint();

    if (!isForce && hasValidArtifacts()) {
        try {
            const savedFingerprint = readFileSync(HASH_FILE, "utf-8").trim();
            if (savedFingerprint === currentFingerprint) {
                console.log("ℹ️ Season data is up to date (cached). Skipping data processing.");
                return;
            }
        } catch {
            // Fall through to regeneration
        }
    }

    console.log("ℹ️ Season data or logic changed. Running data processing...");
    const startTime = performance.now();
    const registry = new ConfigRegistry(
        eventBlueprints as EventBlueprints,
        seasonManifest as SeasonManifest,
        seasonGeocode as SeasonGeocode
    );
    const ingestor = new SeasonDataIngestor(registry);
    const seasonIds = registry.getAllSeasonIds();

    if (!existsSync(OUTPUT_DATA_DIR)) {
        mkdirSync(OUTPUT_DATA_DIR, { recursive: true });
    }

    await Promise.all(
        seasonIds.map(async (seasonId) => {
            const seasonDir = path.join(DATA_DIR, seasonId);
            const siteStates = await ingestor.ingestSeason(seasonId, seasonDir);
            const outputPath = path.join(OUTPUT_DATA_DIR, `${seasonId}.json`);
            await fs.writeFile(outputPath, JSON.stringify(siteStates), "utf-8");
            console.log(`ℹ️ Processed season ${seasonId}: ${Object.keys(siteStates).length} sites.`);
        })
    );

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Season data successfully processed (${seasonIds.length} seasons saved to ${OUTPUT_DATA_DIR}) in ${duration} seconds`);

    mkdirSync(GEN_DIR, { recursive: true });
    writeFileSync(HASH_FILE, currentFingerprint, "utf-8");
}

run().catch((error) => {
    console.error("❌ Fatal error in data processor:", error);
    process.exit(1);
});
