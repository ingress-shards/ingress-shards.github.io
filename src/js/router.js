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

    if (segments.length === 2) {
        const [seriesId, siteId] = segments;
        viewDispatchers.displaySiteDetails(seriesId, siteId);
    } else if (segments.length === 1) {
        const seriesId = segments[0];
        viewDispatchers.displaySeriesDetails(seriesId);
    } else {
        viewDispatchers.showDefaultView();
    }
}

window.addEventListener('popstate', function (e) {
    const newIndex = e.state?.historyIndex || 0;

    IS_NAVIGATING_BACK = (newIndex < lastHistoryIndex);
    lastHistoryIndex = newIndex;

    updateViewFromHash();
});
