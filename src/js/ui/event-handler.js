export const IS_TOUCH_SUPPORTED = isTouchDevice();
export const LAST_INPUT_WAS_TOUCH = false;

function isTouchDevice() {
    return (('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0));
}

let preventSimulatedMouseEvent = false;
window._inputSuppressTimer = null;
const SUPPRESS_DELAY_MS = 750;

document.addEventListener('touchstart', function () {
    window.LAST_INPUT_WAS_TOUCH = true;

    preventSimulatedMouseEvent = true;

    clearTimeout(window._inputSuppressTimer);
    window._inputSuppressTimer = setTimeout(() => {
        preventSimulatedMouseEvent = false;
    }, SUPPRESS_DELAY_MS);
}, { passive: true, capture: true });

document.addEventListener('mousedown', function (e) {
    if (preventSimulatedMouseEvent) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }

    window.LAST_INPUT_WAS_TOUCH = false;
}, { capture: true });

export function addEventInteraction(element, eventType, callback) {
    if (eventType !== 'click') {
        element.on(eventType, callback);
        return;
    }

    if (!IS_TOUCH_SUPPORTED) {
        element.on('click', callback);
        return;
    }

    let clickTimer = null;
    const DOUBLE_CLICK_DELAY = 300;

    element.on('click', function (e) {
        if (!window.LAST_INPUT_WAS_TOUCH) {
            callback(e);
            return;
        }

        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            this.closeTooltip();
            callback(e);
        } else {
            this.openTooltip();

            clickTimer = setTimeout(() => {
                clickTimer = null;
            }, DOUBLE_CLICK_DELAY);
        }
    });
}