import "leaflet/dist/leaflet.css";
import "github-fork-ribbon-css/gh-fork-ribbon.css";
import "../assets/main.css";
import "leaflet";
import "leaflet-providers";
import "leaflet.motion";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import { reviveData } from "./helpers.js";
import { initMapControls, initMapUI, handleCustomFile, displaySeries } from "./ui/ui-handler.js";
import shardSeriesData from "processed_shard_series.json" with { type: "json" };

$(() => {
    $("#custom").on("change", handleCustomFile);
    $("#series").on("change", function () {
        displaySeries(this.value);
    });

    window.map = L.map("map", {
        worldCopyJump: true,
    }).fitWorld();

    polyfillCountryFlagEmojis();
    initMapControls(map);

    try {
        const startTime = performance.now();

        const revivedData = reviveData(shardSeriesData);

        const endTime = performance.now();
        console.debug(
            `Shard data loaded successfully in ${(endTime - startTime) / 1000} seconds: ${revivedData.length} series, ${revivedData.flatMap((event) => event.sites || []).length
            } sites`
        );
        initMapUI(revivedData);
    } catch (error) {
        console.error("Error initializing map UI:", error);
    }
});
