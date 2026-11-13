import type * as L from "leaflet";
import type { ConfigRegistry, SeasonId, SeasonMetadata, SiteId } from "@ingress-shards/ingress-events-core";
import {
    refreshSeriesLayer,
    getDetailsPanelContent as getSeriesDetailsContent,
    setupMarkerHover,
    getSeriesControl,
    initSeriesLayers,
} from "../js/ui/series-renderer.js";
import {
    getSiteLayers,
    getDetailsPanelContent as getSiteDetailsContent,
    updateAllPolylineStyles,
    setActiveSiteLayer,
    getSiteControl,
} from "../js/ui/site-renderer.js";
import { detailsPanelControl } from "../js/ui/details-panel.js";
import { handleCustomFile, getDetailsPanelContent as getCustomDetailsContent } from "../js/ui/custom-file-handler.js";
import { CUSTOM_SEASON_ID, type SeasonDataStore } from "../data/SeasonDataStore.js";
import type { Router } from "../routing/Router.js";
import type { MapState, ViewState } from "../state/MapState.js";

interface TaggedLayer extends L.Layer {
    _layerType?: "series" | "site" | "wave" | "site-overlay";
    _seriesId?: string;
    _siteId?: string;
    _waveId?: string;
    startShardMotion?: () => void;
}

interface DetailsPanelInstance extends L.Control {
    update(content: { title?: string; content: string; footer?: string; flagHtml?: string }): void;
}

interface SiteLayerEntry {
    id: string;
    layer: L.FeatureGroup;
    showByDefault?: boolean;
}

/**
 * Coordinates Leaflet map layers, UI controls, and delegated panel interactions
 * in response to MapState changes.
 */
export class UIController {
    private detailsPanel!: DetailsPanelInstance;
    private seriesControlPanel!: L.Control;
    private waveControlPanel: L.Control | null = null;
    private isMapInteractionActive = false;
    private isOrnamentVisible = false;

    constructor(
        private readonly map: L.Map,
        private readonly configRegistry: ConfigRegistry,
        private readonly dataStore: SeasonDataStore,
        private readonly mapState: MapState,
        private readonly router: Router
    ) {}

    public init(): void {
        this.detailsPanel = detailsPanelControl({ position: "bottomright" }) as DetailsPanelInstance;
        this.map.addControl(this.detailsPanel);

        initSeriesLayers();
        this.seriesControlPanel = getSeriesControl();
        this.map.addControl(this.seriesControlPanel);
        const controlContainer = this.seriesControlPanel.getContainer();
        if (controlContainer) {
            controlContainer.classList.add("ingress-series-control");
            controlContainer.setAttribute("tabindex", "-1");
        }

        this.setupEventListeners();

        this.mapState.subscribeLayerPreferences((preferences) => {
            this.isOrnamentVisible = Boolean(preferences.ornaments);
        });

        this.mapState.subscribeView((view) => {
            void this.onViewChange(view);
        });
    }

    private async onViewChange(view: ViewState): Promise<void> {
        if (!view.seasonId) {
            const defaultSeasonId = this.configRegistry.getDefaultSeasonId();
            if (defaultSeasonId) {
                this.router.navigate(`#/${defaultSeasonId}`);
            }
            return;
        }

        if (view.siteId) {
            await this.displaySiteOrWaveDetails(view.seasonId, view.siteId, view.waveId);
            return;
        }

        await this.displaySeriesDetails(view.seasonId);
    }

    private async displaySeriesDetails(seasonId: SeasonId): Promise<void> {
        this.cleanupLayers({ seriesId: seasonId });

        await this.dataStore.getSeasonData(seasonId);
        const seriesLayer = await refreshSeriesLayer(seasonId);
        if (seriesLayer && !this.map.hasLayer(seriesLayer)) {
            this.map.addLayer(seriesLayer);
        }

        const metadata = this.getSeasonMetadata(seasonId);
        document.title = `${metadata?.name} Season | Ingress Shards Map`;

        let detailsPanelContent = await getSeriesDetailsContent(seasonId);
        if (seasonId === CUSTOM_SEASON_ID) {
            const customDetailsContent = getCustomDetailsContent();
            detailsPanelContent = {
                ...detailsPanelContent,
                title: customDetailsContent.title,
                content: customDetailsContent.content + "<br />" + detailsPanelContent.content,
            };
        }
        this.detailsPanel.update(detailsPanelContent);

        setupMarkerHover(seriesLayer);

        const flyAction = (): void => {
            this.map.flyTo([0, 0], 2, { duration: 1 });
        };
        const viewAction = (): void => {
            this.map.setView([0, 0], 2, { animate: false });
        };
        this.performMapMoveAction(flyAction, viewAction);
    }

    private async displaySiteOrWaveDetails(
        seasonId: SeasonId,
        siteId: SiteId,
        waveId?: string
    ): Promise<void> {
        this.cleanupLayers({ siteId, waveId });

        await this.dataStore.getSeasonData(seasonId);

        const siteLayers = (await getSiteLayers(seasonId, siteId)) as SiteLayerEntry[] | null;
        if (!siteLayers) return;

        const targetLayerId = waveId ?? "all";
        const targetLayerDetails = siteLayers.find((l) => l.id === targetLayerId);
        if (targetLayerDetails) {
            this.map.addLayer(targetLayerDetails.layer);
            setActiveSiteLayer(targetLayerDetails.layer);
        }

        const ornamentLayerDetails = siteLayers.find((l) => l.id === "ornaments");
        if (ornamentLayerDetails && (this.isOrnamentVisible || ornamentLayerDetails.showByDefault)) {
            this.map.addLayer(ornamentLayerDetails.layer);
        }

        const minControlLayers = waveId ? 1 : 0;
        if (siteLayers.length > minControlLayers) {
            this.waveControlPanel = getSiteControl(siteId);
            if (this.waveControlPanel) {
                this.map.addControl(this.waveControlPanel);
                const controlContainer = this.waveControlPanel.getContainer();
                controlContainer?.classList.add("ingress-wave-control");
            }
        }

        const seasonMetadata = this.getSeasonMetadata(seasonId);
        const siteName = this.configRegistry.getSiteConfig(siteId)?.geocode.name;
        document.title = `${seasonMetadata?.name}: ${siteName} | Ingress Shards Map`;
        this.detailsPanel.update(await getSiteDetailsContent(seasonId, siteId, waveId));

        let siteBounds: L.LatLngBounds | null = null;
        if (targetLayerDetails && targetLayerDetails.layer.getLayers().length > 0) {
            siteBounds = targetLayerDetails.layer.getBounds();
        }
        if (ornamentLayerDetails && this.map.hasLayer(ornamentLayerDetails.layer)) {
            const oBounds = ornamentLayerDetails.layer.getBounds();
            if (oBounds.isValid()) {
                siteBounds = siteBounds ? siteBounds.extend(oBounds) : oBounds;
            }
        }

        if (siteBounds && siteBounds.isValid()) {
            const bounds = siteBounds;
            const flyAction = (): void => {
                this.map.flyToBounds(bounds, { duration: 1 });
            };
            const viewAction = (): void => {
                this.map.fitBounds(bounds, { animate: false });
            };
            this.performMapMoveAction(flyAction, viewAction);
        }

        this.map.once("moveend", () => {
            this.map.eachLayer((layer) => {
                const shardLayer = layer as TaggedLayer;
                shardLayer.startShardMotion?.();
            });
        });
    }

    private getSeasonMetadata(seasonId: SeasonId): SeasonMetadata | undefined {
        if (seasonId === CUSTOM_SEASON_ID) {
            return { id: CUSTOM_SEASON_ID, name: "Custom", overviewUrl: "", events: [] } as unknown as SeasonMetadata;
        }
        return this.configRegistry.getSeasonMetadata(seasonId);
    }

    private setupEventListeners(): void {
        this.map.on("zoomend", () => {
            updateAllPolylineStyles(this.map);
        });
        this.map.on("moveend", () => {
            updateAllPolylineStyles(this.map);
        });
        this.map.on("baselayerchange", (event: L.LayersControlEvent) => {
            const tagged = event.layer as TaggedLayer;
            switch (tagged._layerType) {
                case "series":
                    this.router.navigate(`#/${tagged._seriesId}`);
                    break;
                case "site":
                    this.router.navigate(`#/${tagged._seriesId}/${tagged._siteId}`);
                    break;
                case "wave":
                    this.router.navigate(`#/${tagged._seriesId}/${tagged._siteId}/${tagged._waveId}`);
                    break;
            }
        });
        this.map.on("overlayadd", (event: L.LayersControlEvent) => {
            const tagged = event.layer as TaggedLayer;
            if (tagged._layerType === "site-overlay") {
                this.mapState.setLayerPreferences({ ornaments: true });
            }
        });
        this.map.on("overlayremove", (event: L.LayersControlEvent) => {
            const tagged = event.layer as TaggedLayer;
            if (tagged._layerType === "site-overlay") {
                this.mapState.setLayerPreferences({ ornaments: false });
            }
        });

        this.map.on("movestart", () => {
            this.isMapInteractionActive = true;
        });

        this.map.on("moveend", () => {
            setTimeout(() => {
                this.isMapInteractionActive = false;
            }, 1000);
        });

        const panelContainer = this.detailsPanel.getContainer();
        if (!panelContainer) return;

        panelContainer.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target instanceof Element)) return;

            const navTarget = e.target.closest<HTMLElement>(".nav-item");
            if (navTarget?.dataset.route) {
                e.preventDefault();
                e.stopPropagation();
                this.router.navigate(navTarget.dataset.route);
                return;
            }

            const rowTarget = e.target.closest<HTMLElement>("tr");
            if (
                rowTarget &&
                rowTarget.closest("table.ingress-event-scores") &&
                rowTarget.dataset.seriesId &&
                rowTarget.dataset.siteId
            ) {
                e.preventDefault();
                e.stopPropagation();

                const { seriesId, siteId, waveId } = rowTarget.dataset;
                const url = waveId ? `#/${seriesId}/${siteId}/${waveId}` : `#/${seriesId}/${siteId}`;
                this.router.navigate(url);
            }
        });

        panelContainer.addEventListener("change", (e: Event) => {
            if (!(e.target instanceof Element)) return;
            const fileInput = e.target.closest(`#${CUSTOM_SEASON_ID}-file-input`);
            if (fileInput) {
                e.preventDefault();
                e.stopPropagation();
                void handleCustomFile(e);
            }
        });
    }

    private cleanupLayers(target: { seriesId?: string; siteId?: string; waveId?: string }): void {
        this.map.eachLayer((layer) => {
            const tagged = layer as TaggedLayer;
            switch (tagged._layerType) {
                case "series":
                    if (!target.seriesId || tagged._seriesId !== target.seriesId) {
                        this.map.removeLayer(layer);
                    }
                    break;
                case "site":
                    if (!target.siteId || tagged._siteId !== target.siteId) {
                        this.map.removeLayer(layer);
                    }
                    break;
                case "wave":
                    if (!target.siteId || tagged._waveId !== target.waveId) {
                        this.map.removeLayer(layer);
                    }
                    break;
                case "site-overlay":
                    if (!target.siteId || tagged._siteId !== target.siteId) {
                        this.map.removeLayer(layer);
                    }
                    break;
            }
        });
        if (this.waveControlPanel) {
            this.map.removeControl(this.waveControlPanel);
            this.waveControlPanel = null;
        }
        setActiveSiteLayer(null);
    }

    private performMapMoveAction(flyAction: () => void, viewAction: () => void): void {
        const isSwipeBackGesture = this.router.isNavigatingBack && this.isMapInteractionActive;
        if (isSwipeBackGesture) {
            viewAction();
        } else {
            flyAction();
        }
    }
}
