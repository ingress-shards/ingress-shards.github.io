import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapState } from "../state/MapState.js";
import { Router } from "./Router.js";

interface MockWindow {
    localStorage: Storage;
    location: { hash: string };
    history: {
        state: unknown;
        replaceState: ReturnType<typeof vi.fn>;
        pushState: ReturnType<typeof vi.fn>;
    };
    addEventListener: ReturnType<typeof vi.fn>;
    dispatchPopState: (state: unknown, hash: string) => void;
}

function createMockWindow(initialHash = "", initialHistoryState: unknown = null): MockWindow {
    const store = new Map<string, string>();
    const listeners = new Map<string, Array<(event: PopStateEvent) => void>>();

    const mockWindow: MockWindow = {
        localStorage: {
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
        },
        location: { hash: initialHash },
        history: {
            state: initialHistoryState,
            replaceState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
                mockWindow.history.state = state;
                if (typeof url === "string") {
                    mockWindow.location.hash = url;
                }
            }),
            pushState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
                mockWindow.history.state = state;
                if (typeof url === "string") {
                    mockWindow.location.hash = url;
                }
            }),
        },
        addEventListener: vi.fn((type: string, listener: (event: PopStateEvent) => void) => {
            const list = listeners.get(type) ?? [];
            list.push(listener);
            listeners.set(type, list);
        }),
        dispatchPopState: (state: unknown, hash: string) => {
            mockWindow.location.hash = hash;
            mockWindow.history.state = state;
            for (const listener of listeners.get("popstate") ?? []) {
                listener({ state } as PopStateEvent);
            }
        },
    };

    return mockWindow;
}

describe("Router", () => {
    let mockWindow: MockWindow;

    beforeEach(() => {
        mockWindow = createMockWindow();
        vi.stubGlobal("window", mockWindow);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("hydrates MapState from initial URL hash without rewriting history", () => {
        mockWindow.location.hash = "#/2026-apollo/helsinki/wave-2";
        const mapState = new MapState();
        const router = new Router(mapState, "2026-apollo");

        router.start();

        expect(mapState.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: "2026-apollo-helsinki",
            waveId: "wave-2",
        });
        expect(mockWindow.history.replaceState).not.toHaveBeenCalled();
        expect(mockWindow.history.pushState).not.toHaveBeenCalled();
    });

    it("restores saved MapState view via replaceState when hash is empty", () => {
        mockWindow.localStorage.setItem(
            "ingress-shards-map:view:v1",
            JSON.stringify({ seasonId: "2026-apollo", siteId: "2026-apollo-helsinki" })
        );
        const mapState = new MapState();
        const router = new Router(mapState, "fallback-season");

        router.start();

        expect(mockWindow.history.replaceState).toHaveBeenCalledWith(
            { historyIndex: 1 },
            "",
            "#/2026-apollo/helsinki"
        );
        expect(mapState.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: "2026-apollo-helsinki",
            waveId: undefined,
        });
    });

    it("falls back to defaultSeasonId when saved view only has a seasonId", () => {
        mockWindow.localStorage.setItem(
            "ingress-shards-map:view:v1",
            JSON.stringify({ seasonId: "2024-sharedmem" })
        );
        const mapState = new MapState();
        const router = new Router(mapState, "2026-apollo");

        router.start();

        expect(mockWindow.history.replaceState).toHaveBeenCalledWith(
            { historyIndex: 1 },
            "",
            "#/2026-apollo"
        );
        expect(mapState.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: undefined,
            waveId: undefined,
        });
    });

    it("ignores saved custom season and falls back to defaultSeasonId", () => {
        mockWindow.localStorage.setItem(
            "ingress-shards-map:view:v1",
            JSON.stringify({ seasonId: "custom", siteId: "custom-site" })
        );
        const mapState = new MapState();
        const router = new Router(mapState, "2026-apollo");

        router.start();

        expect(mockWindow.history.replaceState).toHaveBeenCalledWith(
            { historyIndex: 1 },
            "",
            "#/2026-apollo"
        );
        expect(mapState.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: undefined,
            waveId: undefined,
        });
    });

    it("uses pushState for subsequent navigations and skips duplicate URLs except #/custom", () => {
        mockWindow.location.hash = "#/2026-apollo";
        const mapState = new MapState();
        const router = new Router(mapState, "2026-apollo");
        router.start();

        router.navigate("#/2026-apollo");
        expect(mockWindow.history.pushState).not.toHaveBeenCalled();

        router.navigate("#/2026-apollo/helsinki");
        expect(mockWindow.history.pushState).toHaveBeenCalledWith(
            { historyIndex: 1 },
            "",
            "#/2026-apollo/helsinki"
        );

        router.navigate("#/custom");
        router.navigate("#/custom");
        expect(mockWindow.history.pushState).toHaveBeenCalledTimes(3);
    });

    it("tracks isNavigatingBack across popstate events", () => {
        mockWindow.location.hash = "#/2026-apollo";
        const mapState = new MapState();
        const router = new Router(mapState, "2026-apollo");
        router.start();

        router.navigate("#/2026-apollo/helsinki");
        expect(router.isNavigatingBack).toBe(false);

        mockWindow.dispatchPopState({ historyIndex: 0 }, "#/2026-apollo");
        expect(router.isNavigatingBack).toBe(true);
        expect(mapState.getView()).toEqual({
            seasonId: "2026-apollo",
            siteId: undefined,
            waveId: undefined,
        });

        mockWindow.dispatchPopState({ historyIndex: 1 }, "#/2026-apollo/helsinki");
        expect(router.isNavigatingBack).toBe(false);
    });

    it("strips matching season prefix in toSiteNavId", () => {
        const router = new Router(new MapState());

        expect(router.toSiteNavId("2026-apollo", "2026-apollo-helsinki")).toBe("helsinki");
        expect(router.toSiteNavId("2026-apollo", "other-site")).toBe("other-site");
    });
});
