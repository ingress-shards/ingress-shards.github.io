import { IS_NAVIGATING_BACK, navigate, setViewDispatchers } from "../router.js";
import { getSeriesLayer, getDetailsPanelContent as getSeriesDetailsContent, setupMarkerHover, getSeriesControl, initSeriesLayers } from "./series-renderer.js";
import { getSiteLayer, getDetailsPanelContent as getSiteDetailsContent, updateAllPolylineStyles, setActiveSiteLayer } from "./site-renderer.js";
import { detailsPanelControl } from "./details-panel.js";
import { handleCustomFile, getDetailsPanelContent as getCustomDetailsContent } from "./custom-file-handler.js";
import { getDefaultSeriesId, getSeriesMetadata, getSeriesGeocode } from "../data/data-store.js";
import { CUSTOM_SERIES_ID } from "../constants.js";

let IS_MAP_INTERACTION_ACTIVE = false;

let map = null;
let detailsPanel, seriesControlPanel;

const mapDispatchers = {
    displaySeriesDetails: (seriesId) => {
        if (!map) return;
        cleanupLayers({ seriesId });

        const seriesLayer = getSeriesLayer(seriesId);
        if (seriesLayer && !map.hasLayer(seriesLayer)) {
            map.addLayer(seriesLayer);
        }

        const metadata = getSeriesMetadata(seriesId);
        document.title = `${metadata?.name} Series | Ingress Shards Map`;

        let detailsPanelContent = getSeriesDetailsContent(seriesId);
        if (seriesId === CUSTOM_SERIES_ID) {
            const customDetailsContent = getCustomDetailsContent();
            detailsPanelContent = {
                title: customDetailsContent.title,
                content: customDetailsContent.content + "<br />" + detailsPanelContent.content,
                footer: detailsPanelContent.footer,
            };
        }
        detailsPanel.update(detailsPanelContent);

        setupMarkerHover(seriesLayer);

        const flyAction = () => { map.flyTo([0, 0], 2, { duration: 1 }); }
        const viewAction = () => { map.setView([0, 0], 2, { duration: 0 }); }
        performMapMoveAction(flyAction, viewAction);
    },
    displaySiteDetails: (seriesId, siteNavigationId) => {
        if (!map) return;
        let siteId = seriesId + "-" + siteNavigationId;
        cleanupLayers({ siteId });

        const siteLayer = getSiteLayer(seriesId, siteId);
        if (siteLayer && !map.hasLayer(siteLayer)) {
            map.addLayer(siteLayer);
            setActiveSiteLayer(siteLayer);
        }

        const seriesMetadata = getSeriesMetadata(seriesId);
        const seriesName = seriesMetadata?.name;
        const siteGeocode = getSeriesGeocode(seriesId)?.sites?.[siteId];
        const location = siteGeocode?.location;
        document.title = `${seriesName}: ${location} | Ingress Shards Map`;
        detailsPanel.update(getSiteDetailsContent(seriesId, siteId));

        const siteBounds = siteLayer.getBounds();
        const flyAction = () => { map.flyToBounds(siteBounds, { duration: 1 }); }
        const viewAction = () => { map.fitBounds(siteBounds, 2, { duration: 0 }); }
        performMapMoveAction(flyAction, viewAction);

        map.once('moveend', () => {
            if (siteLayer.startShardMotion) {
                siteLayer.startShardMotion();
            }
        });
    },
    showDefaultView: () => {
        const defaultSeriesId = getDefaultSeriesId();
        if (defaultSeriesId) navigate(`#/${defaultSeriesId}`);
    }
};

export function initController(mapInstance) {
    map = mapInstance;

    detailsPanel = detailsPanelControl({ position: 'bottomright' });
    map.addControl(detailsPanel);

    initSeriesLayers();
    seriesControlPanel = getSeriesControl();
    map.addControl(seriesControlPanel);
    const controlContainer = seriesControlPanel.getContainer();
    controlContainer.classList.add('ingress-series-control');

    setViewDispatchers(mapDispatchers);
    setupEventListeners(map);
}

function setupEventListeners(map) {
    map.on('zoomend', () => { updateAllPolylineStyles(map); });
    map.on('moveend', () => { updateAllPolylineStyles(map); });
    map.on('baselayerchange', (event) => {
        if (event.layer._seriesId) {
            navigate(`#/${event.layer._seriesId}`);
        }
    });

    map.on('movestart', function () {
        IS_MAP_INTERACTION_ACTIVE = true;
    });

    map.on('moveend', function () {
        setTimeout(() => {
            IS_MAP_INTERACTION_ACTIVE = false;
        }, 1000);
    });

    document.addEventListener('click', (e) => {
        const target = e.target.closest('.nav-item');
        if (target && target.dataset.route) {
            e.preventDefault();
            e.stopPropagation();

            navigate(target.dataset.route);
        }
    });

    document.addEventListener('change', (e) => {
        const target = e.target.closest(`#${CUSTOM_SERIES_ID}-file-input`);
        if (target) {
            e.preventDefault();
            e.stopPropagation();

            handleCustomFile(e);
        }
    });
}

function cleanupLayers(target) {
    map.eachLayer(layer => {
        switch (layer._layerType) {
            case 'series':
                if (!target.seriesId || layer._seriesId !== target.seriesId) {
                    map.removeLayer(layer);
                }
                break;
            case 'site':
                if (!target.siteId || layer._siteId !== target.siteId) {
                    map.removeLayer(layer);
                }
                break;
        }
    });
    setActiveSiteLayer(null);
}

function performMapMoveAction(flyAction, viewAction) {
    const isSwipeBackGesture = IS_NAVIGATING_BACK && IS_MAP_INTERACTION_ACTIVE;
    const shouldAnimate = !isSwipeBackGesture;

    const viewMethod = shouldAnimate ? flyAction : viewAction;
    viewMethod();
}
