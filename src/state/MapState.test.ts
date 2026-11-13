import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapState, type LayerPreferences, type ViewState } from "./MapState.js";

function createMockStorage(initial: Record<string, string> = {}): Storage {
    const store = new Map<string, string>(Object.entries(initial));
    return {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => {
            store.delete(key);
        },
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
    };
}

describe("MapState", () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createMockStorage();
        vi.stubGlobal("window", { localStorage: storage });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("loads persisted view and layer preferences from localStorage", () => {
        storage.setItem(
            "ingress-shards-map:view:v1",
            JSON.stringify({ seasonId: "2026-apollo", siteId: "2026-apollo-helsinki" })
        );
        storage.setItem(
            "ingress-shards-map:layers:v1",
            JSON.stringify({ baseLayer: "OSM", elevation: true })
        );

        const state = new MapState();

        expect(state.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: "2026-apollo-helsinki",
        });
        expect(state.getLayerPreferences()).toEqual({
            baseLayer: "OSM",
            elevation: true,
        });
    });

    it("falls back to empty state when localStorage contains invalid JSON or throws", () => {
        storage.setItem("ingress-shards-map:view:v1", "{bad-json");
        vi.stubGlobal("window", {
            localStorage: {
                ...storage,
                getItem: (key: string) => {
                    if (key === "ingress-shards-map:layers:v1") {
                        throw new Error("SecurityError");
                    }
                    return storage.getItem(key);
                },
            },
        });

        const state = new MapState();

        expect(state.getView()).toEqual({});
        expect(state.getLayerPreferences()).toEqual({});
    });

    it("notifies view subscribers immediately and on updates, persisting to localStorage", () => {
        const state = new MapState();
        const received: ViewState[] = [];

        state.subscribeView((view) => {
            received.push(view);
        });
        state.setView({ seasonId: "2026-apollo", siteId: "2026-apollo-helsinki", waveId: "w1" });
        state.setView({ seasonId: "2026-apollo" });

        expect(received).toEqual([
            {},
            { seasonId: "2026-apollo", siteId: "2026-apollo-helsinki", waveId: "w1" },
            { seasonId: "2026-apollo" },
        ]);
        expect(JSON.parse(storage.getItem("ingress-shards-map:view:v1") ?? "{}")).toEqual({
            seasonId: "2026-apollo",
        });
    });

    it("merges partial layer preferences and notifies subscribers", () => {
        const state = new MapState();
        const received: LayerPreferences[] = [];

        state.subscribeLayerPreferences((prefs) => {
            received.push(prefs);
        });
        state.setLayerPreferences({ baseLayer: "CartoDB Voyager" });
        state.setLayerPreferences({ elevation: true });
        state.setLayerPreferences({ ornaments: false });

        expect(received).toEqual([
            {},
            { baseLayer: "CartoDB Voyager" },
            { baseLayer: "CartoDB Voyager", elevation: true },
            { baseLayer: "CartoDB Voyager", elevation: true, ornaments: false },
        ]);
        expect(JSON.parse(storage.getItem("ingress-shards-map:layers:v1") ?? "{}")).toEqual({
            baseLayer: "CartoDB Voyager",
            elevation: true,
            ornaments: false,
        });
    });

    it("ignores localStorage write errors", () => {
        vi.stubGlobal("window", {
            localStorage: {
                ...storage,
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
            },
        });

        const state = new MapState();
        expect(() => state.setView({ seasonId: "2026-apollo" })).not.toThrow();
        expect(state.getView()).toEqual({ seasonId: "2026-apollo" });
    });
});
