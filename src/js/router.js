let viewDispatchers = {};

let lastHistoryIndex = history.state?.historyIndex || 0;

export let IS_NAVIGATING_BACK = false;

export function setViewDispatchers(dispatchers) {
    viewDispatchers = dispatchers;
    updateViewFromHash();
}

export function navigate(url) {
    const hash = window.location.hash;
    if (hash === url && url !== '#/custom') return;

    lastHistoryIndex++;
    const newState = { path: url, historyIndex: lastHistoryIndex };

    if (hash == '/' && url !== '#/custom') {
        history.replaceState(newState, '', url);
    } else {
        history.pushState(newState, '', url);
    }
    IS_NAVIGATING_BACK = false;

    updateViewFromHash();
}

function updateViewFromHash() {
    const hash = window.location.hash;
    const segments = hash.replace('#', '').split('/').filter(s => s.length > 0);

    const [seriesId, siteId, waveId] = segments
    switch (segments.length) {
        case 1:
            viewDispatchers.displaySeriesDetails(seriesId);
            break;
        case 2:
            viewDispatchers.displaySiteDetails(seriesId, siteId);
            break;
        case 3:
            viewDispatchers.displayWaveDetails(seriesId, siteId, waveId);
            break;
        default:
            viewDispatchers.showDefaultView();
            break;
    }
}

window.addEventListener('popstate', function (e) {
    const newIndex = e.state?.historyIndex || 0;

    IS_NAVIGATING_BACK = (newIndex < lastHistoryIndex);
    lastHistoryIndex = newIndex;

    updateViewFromHash();
});
