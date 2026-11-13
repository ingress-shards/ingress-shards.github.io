import type * as L from "leaflet";

let lastInputWasTouch = false;
let preventSimulatedMouseEvent = false;
let inputSuppressTimer: ReturnType<typeof setTimeout> | null = null;
let isTrackingInitialized = false;

const SUPPRESS_DELAY_MS = 750;
const DOUBLE_CLICK_DELAY_MS = 300;

export function isTouchDevice(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Registers global touch/mouse suppression listeners so simulated mouse events
 * after a touch tap do not trigger duplicate click/hover behavior.
 */
export function initTouchSuppression(): void {
    if (isTrackingInitialized) return;
    isTrackingInitialized = true;

    document.addEventListener(
        "touchstart",
        () => {
            lastInputWasTouch = true;
            preventSimulatedMouseEvent = true;

            if (inputSuppressTimer !== null) {
                clearTimeout(inputSuppressTimer);
            }
            inputSuppressTimer = setTimeout(() => {
                preventSimulatedMouseEvent = false;
            }, SUPPRESS_DELAY_MS);
        },
        { passive: true, capture: true }
    );

    document.addEventListener(
        "mousedown",
        (e: MouseEvent) => {
            if (preventSimulatedMouseEvent) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            lastInputWasTouch = false;
        },
        { capture: true }
    );
}

/**
 * Attaches an interaction handler to a Leaflet layer, requiring a double-tap
 * on touch devices (first tap opens tooltip, second tap fires callback).
 */
export function addEventInteraction(
    element: L.Layer,
    eventType: string,
    callback: L.LeafletEventHandlerFn
): void {
    if (eventType !== "click" || !isTouchDevice()) {
        element.on(eventType, callback);
        return;
    }

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    element.on("click", (e: L.LeafletEvent) => {
        if (!lastInputWasTouch) {
            callback(e);
            return;
        }

        if (clickTimer !== null) {
            clearTimeout(clickTimer);
            clickTimer = null;
            element.closeTooltip();
            callback(e);
        } else {
            element.openTooltip();
            clickTimer = setTimeout(() => {
                clickTimer = null;
            }, DOUBLE_CLICK_DELAY_MS);
        }
    });
}
