import type { SeasonId, SiteId } from "@ingress-shards/ingress-events-core";

export const VALID_BASE_LAYERS = [
    "OSM",
    "CartoDB Positron",
    "CartoDB Dark Matter",
    "CartoDB Voyager",
    "ESRI WorldImagery",
    "ESRI WorldTopoMap",
    "Google Hybrid",
] as const;

export type BaseLayerName = (typeof VALID_BASE_LAYERS)[number];

export interface ViewState {
    readonly seasonId?: SeasonId;
    readonly siteId?: SiteId;
    readonly waveId?: string;
}

export interface LayerPreferences {
    readonly ornaments?: boolean;
    readonly elevation?: boolean;
    readonly baseLayer?: BaseLayerName;
}

export type ViewListener = (view: ViewState) => void;
export type LayerPreferencesListener = (preferences: LayerPreferences) => void;

const VIEW_STORAGE_KEY = "ingress-shards-map:view:v1";
const LAYER_PREFERENCES_STORAGE_KEY = "ingress-shards-map:layers:v1";

/**
 * In-memory observable map state for the active view and layer preferences,
 * persisted independently to localStorage.
 */
export class MapState {
    private view: ViewState;
    private layerPreferences: LayerPreferences;
    private readonly viewListeners = new Set<ViewListener>();
    private readonly layerPreferencesListeners = new Set<LayerPreferencesListener>();

    constructor() {
        this.view = MapState.loadItem<ViewState>(VIEW_STORAGE_KEY);
        this.layerPreferences = MapState.loadItem<LayerPreferences>(LAYER_PREFERENCES_STORAGE_KEY);
    }

    public getView(): ViewState {
        return this.view;
    }

    public getLayerPreferences(): LayerPreferences {
        return this.layerPreferences;
    }

    public subscribeView(listener: ViewListener): void {
        this.viewListeners.add(listener);
        listener(this.view);
    }

    public subscribeLayerPreferences(listener: LayerPreferencesListener): void {
        this.layerPreferencesListeners.add(listener);
        listener(this.layerPreferences);
    }

    public setView(view: ViewState): void {
        this.view = { ...view };
        MapState.saveItem(VIEW_STORAGE_KEY, this.view);
        for (const listener of this.viewListeners) {
            listener(this.view);
        }
    }

    public setLayerPreferences(preferences: LayerPreferences): void {
        this.layerPreferences = { ...this.layerPreferences, ...preferences };
        MapState.saveItem(LAYER_PREFERENCES_STORAGE_KEY, this.layerPreferences);
        for (const listener of this.layerPreferencesListeners) {
            listener(this.layerPreferences);
        }
    }

    private static loadItem<T extends object>(key: string): T {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? (JSON.parse(raw) as T) : ({} as T);
        } catch {
            return {} as T;
        }
    }

    private static saveItem(key: string, value: unknown): void {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Ignore storage quota or private browsing errors
        }
    }
}
