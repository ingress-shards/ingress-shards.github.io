import type { SeasonId, SiteId } from "@ingress-shards/ingress-events-core";
import { CUSTOM_SEASON_ID } from "../data/SeasonDataStore.js";
import type { MapState, ViewState } from "../state/MapState.js";

interface HistoryState {
    historyIndex: number;
}

let activeRouter: Router | null = null;

/**
 * Syncs browser URL hash and History API navigation into MapState.
*/
export class Router {
    private lastHistoryIndex: number;
    private navigatingBack = false;

    constructor(
        public readonly mapState: MapState,
        private readonly defaultSeasonId?: SeasonId
    ) {
        const state = window.history.state as HistoryState;
        this.lastHistoryIndex = state?.historyIndex ?? 0;
    }

    public start(): void {
        window.addEventListener("popstate", this.handlePopState);

        const hashView = this.deserialiseHash(window.location.hash);
        if (hashView.seasonId) {
            this.mapState.setView(hashView);
            return;
        }

        const savedView = this.mapState.getView();
        const fallbackView = savedView.seasonId && savedView.siteId && savedView.seasonId !== CUSTOM_SEASON_ID
            ? savedView
            : { seasonId: this.defaultSeasonId };
        this.navigate(this.serialiseHash(fallbackView));
    }
    
    private readonly handlePopState = (event: PopStateEvent): void => {
        const state = event.state as HistoryState;
        const newIndex = state?.historyIndex ?? 0;

        this.navigatingBack = newIndex < this.lastHistoryIndex;
        this.lastHistoryIndex = newIndex;
    
        this.mapState.setView(this.deserialiseHash(window.location.hash));
    };

    public get isNavigatingBack(): boolean {
        return this.navigatingBack;
    }
    
    public navigate(url: string): void {
        const currentHash = window.location.hash;
        const isCustomRefresh = url === `#/${CUSTOM_SEASON_ID}`;
        if (currentHash === url && !isCustomRefresh) return;

        const newState: HistoryState = { historyIndex: ++this.lastHistoryIndex };
        if ((currentHash === "" || currentHash === "#/") && !isCustomRefresh) {
            window.history.replaceState(newState, "", url);
        } else {
            window.history.pushState(newState, "", url);
        }

        this.navigatingBack = false;
        this.mapState.setView(this.deserialiseHash(url));
    }

    private deserialiseHash(hash: string): ViewState {
        const [seasonId, siteNavId, waveId] = hash
            .replace(/^#\/?/, "")
            .split("/")
            .filter((segment) => segment.length > 0);

        const siteId = seasonId && siteNavId ? `${seasonId}-${siteNavId}` : undefined;
        return { seasonId, siteId, waveId };
    }

    private serialiseHash(view: ViewState): string {
        if (!view.seasonId) return "#/";
        if (!view.siteId) return `#/${view.seasonId}`;
        const siteNavId = this.toSiteNavId(view.seasonId, view.siteId);
        if (!view.waveId) return `#/${view.seasonId}/${siteNavId}`;
        return `#/${view.seasonId}/${siteNavId}/${view.waveId}`;
    }

    public toSiteNavId(seasonId: SeasonId, siteId: SiteId): string {
        const prefix = `${seasonId}-`;
        return siteId.startsWith(prefix) ? siteId.slice(prefix.length) : siteId;
    }
}

/**
 * @deprecated Registers the active Router for legacy src/js/ui/ callers until Slice 2 / Phase 5.
 */
export function registerLegacyRouter(router: Router): void {
    activeRouter = router;
}

/**
 * @deprecated Inject Router instance directly; kept for legacy src/js/ui/ callers until Phase 5.
 */
export function navigate(url: string): void {
    activeRouter?.navigate(url);
}
