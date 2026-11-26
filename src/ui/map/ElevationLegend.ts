import * as L from "leaflet";

/**
 * Contract for UI legends that reflect and toggle elevation scale state.
 */
export interface ElevationLegendView {
    addTo(map: L.Map): this;
    remove(): this;
    update(min: number, max: number): void;
    show(): void;
    hide(): void;
}

/**
 * Leaflet control displaying the hypsometric elevation color ramp for the current viewport.
 */
export class ElevationLegend extends L.Control implements ElevationLegendView {
    private div?: HTMLDivElement;

    constructor(
        private initialMin: number,
        private initialMax: number
    ) {
        super({ position: "topleft" });
    }

    public override onAdd(): HTMLElement {
        this.div = L.DomUtil.create("div", "elevation-legend") as HTMLDivElement;
        this.update(this.initialMin, this.initialMax);
        return this.div;
    }

    public override onRemove(): void {
        this.div = undefined;
    }

    public update(min: number, max: number): void {
        if (!this.div) return;
        const steps = 19;
        const fragment = document.createDocumentFragment();
        for (let i = steps; i >= 0; i--) {
            const ratio = i / steps;
            const val = min + ratio * (max - min);
            const item = document.createElement("div");
            item.className = "elevation-legend-item";
            item.textContent = `${val.toFixed(0)} m`;
            fragment.appendChild(item);
        }
        this.div.replaceChildren(fragment);
    }

    public show(): void {
        this.div?.classList.add("is-visible");
    }

    public hide(): void {
        this.div?.classList.remove("is-visible");
    }
}
