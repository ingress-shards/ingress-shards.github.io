# Ingress Shard Map V2: Potential Future Enhancements

This document tracks technical improvements, feature backlog items, and architectural enhancements identified during the V2 migration that are beyond the immediate scope of the initial re-platforming onto [`@ingress-shards/ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core).

---

## 1. Data Pipeline & Domain Modeling

### Evaluate Stripping `ShardMove.scoredRules` in Phase 5 (Map Link Popups)
- **Context**: `ShardMove` objects inside `SiteAnalysis.siteShardPaths` currently store both `scoredRules?: string[]` and `totalPoints?: number`. Across all 10 historical seasons, `scoredRules` accounts for ~300+ KB of serialized JSON.
- **Architectural Decision (Deferred to Phase 5)**:
  - Map link popups only require `ShardMove.totalPoints` to display the points awarded on a link, whereas detailed rule-level breakdowns are already pre-calculated per jump window in `WaveState.shardJumpWindows[].factionBreakdowns` for the Wave Analyser.
  - During Phase 5 (Map & Layer Management), once map link popup requirements are finalized and migrated, evaluate stripping `scoredRules` from serialized `ShardMove` entries while retaining `totalPoints`.

### Recursive Portals Ingestion & Processing
- **Context**: Ingress event mechanics can include "recursive portals" (portals with recurring shard cycles or special anomalous wave rules). 
- **Current State**: [`DataFiles.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/types/DataFiles.ts) defines `recursivePortals` metadata (`importPattern: /^recursive-portals.*\.json$/i`) and [`Portal.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/sites/Portal.ts) declares `RecursiveHistoryEntry` (`type: "recursive"`). However, Core does not yet possess a dedicated `RecursivePortalsAdapter` in `src/types/processing/adapters/`.
- **Target Enhancement**:
  - Implement `RecursivePortalsAdapter` in Core with full unit test coverage.
  - Wire the adapter into `DataIngestionPipeline` to merge recursive portal observations into the unified portal history.
  - Update pre-processor loaders and UI map renderers to display recursive status or custom portal ornaments.

### Review & Elevation of Shared Date and Data Helpers (Phase 5)
- **Context**: Date and duration formatting helpers currently reside in src/js/shared/date-helpers.js. In addition, ad-hoc fragment clustering logic exists in src/js/data/json-parser-worker.js.
- **Target Enhancement**:
  - In Phase 5 (UI & Renderer Adaptation), review all helper methods in date-helpers.js (ormatIsoToShortDate, ormatEpochToLocalTime, ormatEpochToLocalDateTime, getTimeRemaining, getActiveEventRemaining) and migrate them into @ingress-shards/ingress-events-core (src/common/Date.ts / src/display/), unifying temporal formatting between the map application and IITC plugin.
  - Review and deprecate legacy ad-hoc clustering helpers in json-parser-worker.js (getCoordsForFragment, getFragmentSpawnTimeMs, calculateCentroid) in favor of Core's DataObservationAdapter.

### Domain Concept Naming Alignment (`SiteRecord`)
- **Context**: The naming of `SiteRecord` causes conceptual confusion with TypeScript's built-in `Record<K, V>` utility type (similarly to how `SeasonRecord` was pruned).
- **Target Enhancement**:
  - In a dedicated post-migration phase, evaluate renaming `SiteRecord` to a more descriptive domain term (e.g., `SiteTelemetry`, `SiteObservationData`, or `SiteData`).
  - Align type naming across all sibling repositories ([`ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core), [`ingress-shards.github.io`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io), and [`iitc-plugin-site-observer`](file:///c:/Users/Lewis/git/yeggs-github/iitc-plugin-site-observer)).

---

## 2. Custom Season & User Experience

### Full Custom Season Processing via Core Engine
- **Context**: Currently, user-dropped files in [`custom-file-handler.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/custom-file-handler.js) parse through a legacy Web Worker (`json-parser-worker.js`) running obsolete `data-processor.js` logic. Furthermore, [`SeasonDataStore.ts`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/data/SeasonDataStore.ts) maintains a static stub for `CUSTOM_SEASON_ID` (`custom`) that does not dynamically register with `EventConfigRegistry`.
- **Target Enhancement**:
  - Replace the legacy worker with a TypeScript worker or service utilizing Core's [`DataIngestionPipeline`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core/src/sites/processing/DataIngestionPipeline.ts).
  - Dynamically register uploaded season metadata, geocodes, and timeline blueprints into `EventConfigRegistry` (e.g. via a dedicated `registerSite(siteConfig: SiteConfig)` method on `EventConfigRegistry`).
  - Support multi-file batch drag-and-drop (e.g., dropping discovery, target portals, and shard jump logs simultaneously to synthesize an ad-hoc custom event site).
  - Enable local export of the synthesized site record to JSON directly from the map UI.

---

## 3. Map Rendering & Display

### Interactive Scoring Breakdown & Display Elevation
- **Context**: IITC Plugin features advanced tooltip scoring breakdowns and jump history grouper utilities.
- **Target Enhancement**:
  - Elevate `ScoringTableComponent` and `ShardJumpGrouper` display modules from Core into modern TypeScript map UI widgets.

### Event Step-by-Step Replay with Keyboard Shortcuts
- **Context**: Currently, the map renders all jumps, paths, and targets statically for the active site view without an interactive playback mechanism.
- **Target Enhancement**:
  - Allow step-by-step replay of event progression across jump windows, waves, and shard movements.
  - Support keyboard shortcuts (e.g., Left/Right arrows to step backward/forward, Space to pause/resume playback, Home/End to jump to start/finish).
  - Synchronize map entity states (active links, current shard positions, portal targets) dynamically with the active playback step.

### Enhanced Mobile UX
- **Context**: The current map viewer is primarily desktop-oriented; small screen viewports and touch devices can experience crowded overlays and difficult navigation.
- **Target Enhancement**:
  - Deliver a responsive mobile experience with touch-optimized tap targets, collapsible controls, and streamlined drawer / bottom sheet panels for event information.
  - Improve gesture responsiveness and touch panning/zooming on mobile devices.

### Single Active Tooltip on Mobile (Tap Only)
- **Context**: Hover-triggered tooltips do not map cleanly to touch screens, often leading to persistent, overlapping tooltips that occlude portals and shard paths.
- **Target Enhancement**:
  - Restrict mobile tooltip display to explicit tap actions only (no simulated hover).
  - Ensure only one tooltip is visible at a time on mobile devices, automatically dismissing the active tooltip when tapping elsewhere on the map or selecting a different entity.

### Internationalization (i18n) & Localization
- **Context**: Map UI controls, status indicators, scoring tables, tooltips, and faction labels are currently hardcoded in English.
- **Target Enhancement**:
  - Implement a lightweight i18n layer / locale string catalog.
  - Provide translated UI strings for major Ingress player languages (e.g., Japanese, German, Spanish, French).
  - Format dates, times, and numbers according to user locale preferences via `Intl` and `temporal-polyfill`.

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

### Package Manager Migration: NPM to Yarn Berry (Yarn 4)
- **Context**: `ingress-shards.github.io` currently uses NPM (`package-lock.json`), whereas sibling repositories ([`ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core) and [`iitc-plugin-site-observer`](file:///c:/Users/Lewis/git/yeggs-github/iitc-plugin-site-observer)) and the umbrella workspace root use Yarn Berry (v4) with the `node-modules` linker (`nodeLinker: node-modules`). This creates divergence in workspace tooling, script execution (`npm --prefix` vs `yarn --cwd`), and local/CI dependency resolution.
- **Target Enhancement**:
  - Migrate package management from NPM to Yarn Berry (v4), standardizing toolchain alignment across all three repositories.
  - Standardize workspace-level dispatch commands to `yarn --cwd ingress-shards.github.io <command>`.
  - Replace `package-lock.json` with `yarn.lock` and configure `.yarnrc.yml` with `nodeLinker: node-modules`.
  - Update GitHub Actions CI workflows (`.github/workflows/validate.yml` and `.github/workflows/deploy.yml`) to use Corepack and Yarn Berry.

### Language Migration: Complete JavaScript to TypeScript Conversion
- **Context**: `ingress-shards.github.io` currently operates in a hybrid mode (`allowJs: true` in `tsconfig.json`). While newly introduced V2 data layers (`src/data/`) and adapters are written in TypeScript, legacy UI components, map controllers, event handlers, and web workers under `src/js/` remain in plain JavaScript (ES modules).
- **Target Enhancement**:
  - Incrementally migrate all remaining JavaScript modules (`src/js/**/*.js`) to TypeScript (`.ts`).
  - Introduce strict domain interfaces for map visual elements, layer controllers, UI state management, and Leaflet extension points.
  - Transition the build pipeline from esbuild JavaScript bundling to fully type-checked TypeScript compilation (`strict: true`, `noImplicitAny: true`).
  - Reorganize legacy directory layouts (e.g., merging `src/js/` into modular TypeScript packages such as `src/ui/`, `src/map/`, `src/workers/`).
