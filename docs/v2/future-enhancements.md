# Ingress Shard Map V2: Potential Future Enhancements

This document tracks technical improvements, feature backlog items, and architectural enhancements identified during the V2 migration that are beyond the immediate scope of the initial re-platforming onto [`@ingress-shards/ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core).

---

## 1. Data Pipeline & Domain Modeling

### Recursive Portals Ingestion & Processing
- **Context**: Ingress event mechanics can include "recursive portals" (portals with recurring shard cycles or special anomalous wave rules). 
- **Current State**: [`DataFiles.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/types/DataFiles.ts) defines `recursivePortals` metadata (`importPattern: /^recursive-portals.*\.json$/i`) and [`Portal.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/sites/Portal.ts) declares `RecursiveHistoryEntry` (`type: "recursive"`). However, Core does not yet possess a dedicated `RecursivePortalsAdapter` in `src/types/processing/adapters/`.
- **Target Enhancement**:
  - Implement `RecursivePortalsAdapter` in Core with full unit test coverage.
  - Wire the adapter into `SiteDataProcessor` to merge recursive portal observations into the unified portal history.
  - Update pre-processor loaders and UI map renderers to display recursive status or custom portal ornaments.

### Domain Model Renaming (`SiteRecord`)
- **Context**: The naming of `SiteRecord` causes conceptual confusion with TypeScript's built-in `Record<K, V>` utility type (similarly to how `SeasonRecord` was pruned).
- **Target Enhancement**:
  - In a dedicated post-migration phase, evaluate renaming `SiteRecord` to a more descriptive domain term (e.g., `SiteTelemetry`, `SiteObservationData`, or `SiteData`).
  - Align type naming across all sibling repositories ([`ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core), [`ingress-shards.github.io`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io), and [`iitc-plugin-site-observer`](file:///c:/Users/Lewis/git/yeggs-github/iitc-plugin-site-observer)).

---

## 2. Custom Season & User Experience

### Full Custom Season Processing via Core Engine
- **Context**: Currently, user-dropped files in [`custom-file-handler.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/custom-file-handler.js) parse through a legacy Web Worker (`json-parser-worker.js`) running obsolete `data-processor.js` logic. Furthermore, [`SeasonDataStore.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/data/SeasonDataStore.ts) maintains a static stub for `CUSTOM_SEASON_ID` (`custom`) that does not dynamically register with `EventConfigRegistry`.
- **Target Enhancement**:
  - Replace the legacy worker with a TypeScript worker or service utilizing Core's [`SiteDataProcessor`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/sites/processing/SiteDataProcessor.ts).
  - Dynamically register uploaded season metadata, geocodes, and timeline blueprints into `EventConfigRegistry`.
  - Support multi-file batch drag-and-drop (e.g., dropping discovery, target portals, and shard jump logs simultaneously to synthesize an ad-hoc custom event site).
  - Enable local export of the synthesized site record to JSON directly from the map UI.

---

## 3. Map Rendering & Display

### Interactive Scoring Breakdown & Display Elevation
- **Context**: IITC Plugin features advanced tooltip scoring breakdowns and jump history grouper utilities.
- **Target Enhancement**:
  - Elevate `ScoringTableComponent` and `ShardJumpGrouper` display modules from Core into modern TypeScript map UI widgets.

### (Low Priority) Interactive Timeline Playback Scrubber
- **Context**: Currently, the map renders all jumps, paths, and targets statically for the active site view.
- **Target Enhancement**:
  - Optional timeline scrubber control allowing users to step or scrub minute-by-minute across event waves to visualize dynamic shard movements over time.

---

## 4. Verification & Testing

### (Exploratory) Automated Visual Regression Suite
- **Context**: Unit tests and schema validation verify data integrity and build outputs, but do not verify visual layout regressions across rendering layers.
- **Target Enhancement**:
  - Investigate headless browser visual testing (e.g., Playwright) to capture baseline screenshots of sample archetype sites across historical seasons (`2024-erasedmem` through `2026-apollo`) to catch unintended layout, layer, or CSS regressions during large UI refactors.

---

## 5. Tooling & Linting Alignment

### ESLint & Unicorn Alignment with Sibling Repositories
- **Context**: [`ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core) and [`iitc-plugin-site-observer`](file:///c:/Users/Lewis/git/yeggs-github/iitc-plugin-site-observer) use `eslint-plugin-unicorn` alongside TypeScript-ESLint, disabling post-ES2022 rules (`unicorn/no-array-sort` and `unicorn/prefer-iterator-to-array`) for ES2022 compatibility. In `ingress-shards.github.io`, the project currently uses standard `@eslint/js` and `typescript-eslint` without Unicorn to prevent imposing 300+ stylistic and non-deterministic violations across legacy JavaScript modules in `src/js/`.
- **Target Enhancement**:
  - Once legacy modules under `src/js/` are refactored or migrated to modern TypeScript in future V2 iterations, install `eslint-plugin-unicorn`.
  - Align [`eslint.config.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/eslint.config.js) with the sibling repositories:
    - Enforce `unicorn/filename-case: ["error", { case: "kebabCase" }]` (matching Rule 6.B).
    - Disable post-ES2022 rules (`unicorn/no-array-sort`, `unicorn/prefer-iterator-to-array`) consistent with the ES2022 target.
    - Curate or tune Unicorn rules to avoid disruptive changes to established project patterns.

