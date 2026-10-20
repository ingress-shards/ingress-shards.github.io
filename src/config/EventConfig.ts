import { EventConfigRegistry } from "@ingress-shards/ingress-events-core";
import type { EventBlueprints, SeasonGeocode, SeasonManifest } from "@ingress-shards/ingress-events-core";
import eventBlueprints from "@ingress-shards/ingress-events-core/conf/event_blueprints.json";
import seasonManifest from "@ingress-shards/ingress-events-core/conf/season_manifest.json";
import seasonGeocode from "@ingress-shards/ingress-events-core/conf/season_geocode.json";

/**
 * Central event configuration registry singleton for the Map application.
 * Encapsulates blueprints, season manifests, geocodes, and precomputed timelines.
 *
 * @deprecated Pending migration to direct instantiation in the src/index.ts composition root.
 */
const eventConfigRegistry = new EventConfigRegistry(
    eventBlueprints as unknown as EventBlueprints,
    seasonManifest as unknown as SeasonManifest,
    seasonGeocode as unknown as SeasonGeocode
);

/**
 * @deprecated Transitional singleton export. In Phase 4/5, EventConfigRegistry will be instantiated
 * directly in the src/index.ts composition root and injected into dependent services.
 *
 * Returns the central EventConfigRegistry instance.
 */
export function getEventConfigRegistry(): EventConfigRegistry {
    return eventConfigRegistry;
}
