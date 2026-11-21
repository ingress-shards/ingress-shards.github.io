import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteState, SiteStateMap } from "@ingress-shards/ingress-events-core";
import { SeasonDataStore } from "./SeasonDataStore.js";

describe("SeasonDataStore", () => {
    const sampleSiteState: SiteState = {
        metadata: {
            siteId: "2026-apollo-helsinki",
            seasonId: "2026-apollo",
            lastUpdated: 1_780_315_200_000,
        },
        telemetry: {
            portals: {
                101: { title: "Sample Portal", latE6: 60_169_900, lngE6: 24_938_400 },
            },
            shards: {},
        },
        analysis: {
            waves: {
                1: {
                    points: {},
                    shardJumpWindows: [],
                },
            },
        },
    };

    const seasonMap: SiteStateMap = {
        "2026-apollo-helsinki": sampleSiteState,
    };

    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => seasonMap,
        });
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("fetches once, caches season telemetry, and returns raw V2 SiteState from getSiteState", async () => {
        const store = new SeasonDataStore();

        const first = await store.getSiteState("2026-apollo", "2026-apollo-helsinki");
        const second = await store.getSiteState("2026-apollo", "2026-apollo-helsinki");

        expect(first).toBe(sampleSiteState);
        expect(second).toBe(sampleSiteState);
        expect(first).not.toHaveProperty("geocode");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("data/2026-apollo.json");
    });

    it("returns undefined from getSiteState when the siteId is absent", async () => {
        const store = new SeasonDataStore();

        const result = await store.getSiteState("2026-apollo", "nonexistent-site");
        expect(result).toBeUndefined();
    });

    it("preserves legacy adaptation on deprecated getSiteData", async () => {
        const store = new SeasonDataStore();

        const legacy = (await store.getSiteData("2026-apollo", "2026-apollo-helsinki")) as Record<string, unknown>;
        expect(legacy).toBeDefined();
        expect(legacy).toHaveProperty("geocode");
        expect(legacy).toHaveProperty("portals");

        const missing = await store.getSiteData("2026-apollo", "nonexistent-site");
        expect(missing).toBeUndefined();
    });
});
