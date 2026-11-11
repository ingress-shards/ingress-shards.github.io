import { ConfigRegistry } from "@ingress-shards/ingress-events-core";
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
const configRegistry = new ConfigRegistry(
    eventBlueprints as unknown as EventBlueprints,
    seasonManifest as unknown as SeasonManifest,
    seasonGeocode as unknown as SeasonGeocode
);

/**
 * Returns the central ConfigRegistry instance.
 */
export function getConfigRegistry(): ConfigRegistry {
    return configRegistry;
}
