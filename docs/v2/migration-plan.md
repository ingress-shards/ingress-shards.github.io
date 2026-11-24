# Ingress Shard Map V2 Migration Plan

## 1. Overview & Objectives

Version 2 of the Ingress Shard Map re-platforms the project to consume [`@ingress-shards/ingress-events-core`](https://github.com/ingress-shards/ingress-events-core) as an external dependency and progressively adopts **TypeScript** to achieve end-to-end type safety across the entire ecosystem.

### Core Goals:
- **Single Source of Truth**: Eliminate duplicated event mechanics, blueprints, scoring logic, and configuration between the shard map and IITC plugin.
- **Mature Data Pipeline**: Replace the legacy 33 KB monolithic `data-processor.js` with Core's unit-tested processors (`DataIngestionPipeline`, `SiteStateMerger`, `DefaultPortalMergeStrategy`, `ShardJumpWindowBuilder`, `ShardPathBuilder`).
- **End-to-End TypeScript Alignment**: Transition the Map application to TypeScript incrementally, consuming Core's strict domain models (`SiteConfig`, `EventTimeline`, `SeasonConfig`, `SiteState`) with zero runtime shape ambiguity.
- **Semantic Parity**: Ensure that all historical events continue to produce identical scoring, statistics, portal counts, and jump paths.
- **Controlled Rollout**: Use an integration branch model to prevent breaking `main` or premature `semantic-release` triggers.

---

## 2. Git Branching & Release Strategy

Because `main` automatically publishes releases via `semantic-release` and deploys immediately to GitHub Pages, all multi-phase breaking changes occur on an integration branch.

```
main (v1.42.x) ──┬────────────────────────────────────────────┬──> v2.0.0 (Release)
                 │                                            │
                 └── feat/v2-core-integration ────────────────┘
                         ▲                ▲
                         │ (PR)           │ (PR)
                     feat/v2-plumbing  feat/v2-pipeline
```

### Strategy Rules:
1. **Integration Branch (`feat/v2-core-integration`)**:
   - Created from `main`.
   - Sub-task branches PR into `feat/v2-core-integration`.
   - CI validates builds without publishing npm packages or triggering GitHub Pages deployments.
2. **Parallel Maintenance**:
   - Urgent bug fixes for V1 continue to branch from and merge into `main` (triggering standard `v1.42.x` patch releases).
   - `main` is periodically merged/rebased into `feat/v2-core-integration`.
3. **The V2 Release Handshake**:
   - When all phases pass full validation and semantic parity tests, a single PR is opened from `feat/v2-core-integration` into `main`.
   - The squash/merge commit message includes:
     ```text
     feat: integrate ingress-events-core architecture for version 2

     BREAKING CHANGE: Migrates data pipeline, domain models, and codebase to TypeScript and @ingress-shards/ingress-events-core.
     ```
   - `semantic-release` automatically tags `v2.0.0`.

---

## 3. Incremental TypeScript Adoption Strategy

To maintain development velocity and avoid throwaway work, TypeScript is adopted **incrementally** across the phases:

```
[Phase 1-2: Setup & TS] ──> [Phase 3: Pipeline] ──> [Phase 4: Utilities] ──> [Phase 4a: Glue in TS] ──> [Phase 5a-5g: UI & Display Slices] ──> [Phase 6-7: Parity & Release]
 feat/v2-core-integration    process-season-data.ts  Prune math/constants     index, router, map,        5a: Core Elevation (Tooltips/Date)       verify-v1-v2-parity.ts
 EventConfig, SeasonDataStore Prune data-processor.js  (date-helpers -> Ph 5)   events, controller in TS   5b-1..3: Leaf Utils, Elevation, Theme    100% strict TS, v2.0.0
                                                                                                         5c: DetailsPanel & Scoring Views
                                                                                                         5d: Map Layers (Season/Site/Wave)
                                                                                                         5e: Controls & Settings Menu UX
                                                                                                         5f: Custom File Ingestion
                                                                                                         5g: Legacy Pruning & Zero-JS
```

1. **Phase 1 (Setup & Branching):**
   - Create long-lived integration branch `feat/v2-core-integration` from `main`, configure `.npmrc`, and align `@ingress-shards/ingress-events-core` and `temporal-polyfill` across sibling repositories.
2. **Phase 2 (Configuration, Toolchain & TypeScript Setup):**
   - Install `typescript` (^5.9.3), `ts-loader`, `@types/node`.
   - Add `tsconfig.json` with `"allowJs": true`, `"checkJs": false`, `"strict": true`, and `"moduleResolution": "bundler"`.
   - Configure `webpack.common.js` with `ts-loader` and `.ts` extension resolution / extension aliases.
   - Author new/migrated configuration and data store layers in TypeScript directly under `src/<domain>/` (`src/config/EventConfig.ts`, `src/data/SeasonDataStore.ts`).
   - Legacy JavaScript files (`data-processor.js`, `site-renderer.js`, etc.) remain in `src/js/` undisturbed.
3. **Phase 3 (Offline Data Pipeline & Pre-processor Migration):**
   - Install `tsx` devDependency for direct, zero-build execution of TypeScript CLI scripts.
   - Author offline pipeline in TypeScript (`scripts/process-season-data.ts`).
   - Relocate offline logic out of `src/js/` into Core's domain pipeline (`DataIngestionPipeline`, `SiteStateAnalyser`).
   - Implement deterministic chronological file staging (ornaments → target portals → timestamped shard jumps) with in-memory accumulator writeback per season to prevent overriding site states or losing historical telemetry.
   - Execute final comprehensive analysis pass (`SiteStateAnalyser`, `WaveAnalyser`, `LinkScoringEngine`, `SeasonPointsCalculator`, centroids) on the fully accumulated portal graph.
   - Embed validation, anomaly metrics (`invalidActions`, `mismatchedMoves`, `mismatchedScoringJumps`, `extendedJumpWindows`), and jump window durations natively into `SiteState`.
   - Retire legacy CSV reports (`actions-outside-window.csv`, `invalid-shard-sequences.csv`, `link-alignment-mismatches.csv`, `site-statistics.csv`, `validation-summary.json`) and eliminate `scripts/validation/` and transitional adapters.
   - Provide transitional UI bridging in `SeasonDataStore.ts` so existing Leaflet renderers remain fully functional until Phase 5.
   - Completely delete `src/js/data/shard-jumps/` directory (`data-processor.js`, `data-helpers.js`, `data-validator.js`, `data-statistics.js`).
   - Optimize CI release workflow by dropping obsolete `processed-data` and `validation-reports` uploads (retaining Pages deployment).
4. **Phase 4 (Shared Utility & Constants Pruning):**
   - Replace `src/js/shared/math-helpers.js` usages with Core `Geo`.
   - Replace hardcoded palettes and constants in `constants.js` with canonical exports from `@ingress-shards/ingress-events-core` and prune `constants.js`.
   - Replace `event-helpers.js` with direct reads of `siteConfig.timeline.activeDurationMinutes` via `ConfigRegistry`.
   - (`src/js/shared/date-helpers.js` migration is deferred to Phase 5a alongside UI formatting.)
5. **Phase 4a (Glue & Infrastructure Review & TypeScript Migration):**
   - Add `@types/leaflet` and ambient declarations (`src/types/ambient.d.ts`) for Webpack globals, CSS/asset imports, and untyped Leaflet plugins.
   - Implement typed observable `MapState` (`src/state/MapState.ts`) with independent `localStorage` persistence.
   - Review, improve, and migrate core glue modules (`index.ts`, `Router.ts`, `touchSupport.ts`, `MapManager.ts`, `UIController.ts`) to TypeScript before UI renderer refactoring.
6. **Phase 5 (UI & Display Adaptation in TypeScript — Incremental Slices):**
   - **Phase 5a (Core Display & Tooltip Elevation)**: Elevate framework-agnostic HTML generators for tooltips (portal, link, wave, goal, link rules), scoring tables, and date/countdown helpers into Core (`src/display/` & `src/common/Date.ts`).
   - **Phase 5b-1 (Leaf Utilities, Marker Templates & Panes)**: Standardize Core's `src/visuals/templates/` on `render*` functions (`renderSiteMarker`, `renderExportIcon`, `renderOrnamentIcon`, `renderOrnamentPortal`, `renderTargetOrnament`, `renderFlagIcon`) with zero inline styles, consume them in Map & Plugin, export typed `MAP_PANES` constants, deduplicate Core `visuals.css` marker/radar styles, and delete `ui-formatters.js` & `marker-template.js`.
   - **Phase 5b-2 (Elevation Overlay Refactor)**: Split `elevation.js` & `ElevationOverlay.ts` into `elevationMath.ts`, `ElevationLegend.ts`, and `ElevationOverlay.ts`; fix single-fetch DEM sampling, `pixelSizeMeters` hillshade scaling, `tileunload` eviction, and official `leaflet-relief` types.
   - **Phase 5b-3 (Theming Engine & Base-Layer Sync)**: Add dark-default surface tokens and `:root[data-theme="light"]` overrides in Core `tokens.css` / `display.css`; add `theme: "light" | "dark" | "system"` (default `"system"`) to `MapState`; wire `ThemeManager` (`data-theme` + `matchMedia`) and auto-sync default base map only when no manual `baseLayer` override is set.
   - **Phase 5c (Details Panel & Scoring Views)**: Finalize `lit-html` vs framework-free TS decision; migrate `DetailsPanel.ts` to a typed component reacting to `MapState` and theme; wire Core `ScoringTable`, `ShardJumpGrouper`, and interactive popovers.
   - **Phase 5d (Season & Site Map Layers)**: Migrate `SeasonLayer.ts`, `SiteLayer.ts`, and `WaveLayer.ts` to TypeScript, consuming `SiteState` directly and using Core's unified tooltips; slim down `UIController.ts`.
   - **Phase 5e (UI Controls Consolidation & Theme Switcher)**: Consolidate map corner controls (base maps, overlays, theme toggle, GitHub link, season/wave controls) into a cohesive settings/hamburger menu UX once all panels and layers are in TypeScript.
   - **Phase 5f (Custom File Ingestion)**: Migrate custom file handler and worker to TypeScript using Core's `DataObservationAdapter` and `DataIngestionPipeline`.
   - **Phase 5g (Legacy Pruning & Zero-JS Cutover)**: Drop `adaptSiteStateToLegacy` from `SeasonDataStore.ts`, delete `src/js/`, set `allowJs: false`, and verify clean zero-JS build.
7. **Phase 6 (Semantic Parity Verification & Testing):**
   - Implement `scripts/verify-v1-v2-parity.ts` to verify the 5 Domain Invariants across all historical seasons (`2024-erasedmem` through `2026-apollo`) and perform visual checks on Anomaly, Skirmish, and StandBy archetype sites.
   - Review `iitc-plugin-site-observer` UI components (`SiteTableComponent`, `ToolsMenuComponent`, `ObserverView`, and UI hosts/controls) to identify structural and code-quality improvements aligned with the finalized Phase 5 display and templating patterns.
8. **Phase 7 (Release & Cutover to V2):**
   - Entire codebase is 100% TypeScript with complete compile-time type safety; run final `npm run validate`, merge `feat/v2-core-integration` to `main`, and cut `v2.0.0`.

---

## 4. Phase 5 Display Architecture: Containers vs. Content, Tooltip Unification & Theming

To maintain long-term maintainability and prevent visual or behavioral divergence between the IITC Plugin and the Shard Map, Phase 5 enforces a strict separation between **Leaflet Container Mechanics** and **Core Content Generation**:

### 4.1 Container Mechanics vs. Content Generation

| Display Concept | Leaflet / Map Application (Where & How it is hosted) | Core Display Module (What renders inside it) |
| :--- | :--- | :--- |
| **Panes** | Z-index viewport stacking contexts (`map.createPane()`): `ornamentPane`, `ornamentFrontPane`, `targetPane`, `shardPane`. | *Pure CSS z-index and pointer-event declarations.* |
| **Controls / Panels** | Viewport-pinned corner chrome (`L.Control`): `DetailsPanel`, `ElevationLegend`. | **`DetailsPanel`**, **`ScoringTable`**, **`ElevationLegend`** content. |
| **Layers** | Geographic lat/lng entities on panes (`L.Marker`, `L.Polyline`, `L.FeatureGroup`). | **`SiteMarker`**, **`ShardMotionPolyline`**, **`TargetOrnament`** SVG/CSS templates. |
| **Tooltips & Popovers** | Anchored overlays (`L.Tooltip`, `L.Popup`, or interactive table cell popovers). | **Unified Tooltip Generators**: Portal telemetry, Link details, Wave summary, Goal breakdown, Link breakdown. |

### 4.2 Tooltip & Popover Unification
Historically, both the IITC Plugin and the Map independently formatted site/portal tooltips, link jump paths, and scoring summaries. In Phase 5, all HTML renderers, DOM resolvers, and the shared floating overlay host are elevated into Core (`src/display/tooltips/`):
- `renderSiteTooltip({ siteConfig, eventTypeLabel, siteState, nowMs })` + `createSiteTooltipResolver`: Active/grace banners, flag, site name, formatted date/countdown, event type, and score or ornament summary.
- `renderPortalTooltip({ portal, shardHistory, ornaments, siteConfig })` + `createPortalTooltipResolver`: Portal title, Intel link, target faction badge, ornament label(s), and chronological shard arrival/departure telemetry.
- `renderPathTooltip({ shardPath, portalA, portalB, portalAId, siteConfig })` + `createPathTooltipResolver`: Endpoints, distance, link timestamps, jump movements with awarded points, and random idle teleports.
- `renderWaveTooltip({ siteConfig, waveNum, waveState })` + `createWaveTooltipResolver`: Jump group action counts, duration (`actualEnd - scheduledStart`), and duration warning thresholds.
- `renderGoalScoringTooltip({ siteConfig, waveState, faction, portals, goalRules })` + `createGoalScoringTooltipResolver`: Target portal breakdown by jump group with scored/unscored counts.
- `renderLinkScoringTooltip({ siteConfig, waveState, faction, linkRules })` + `createLinkScoringTooltipResolver`: Rule-by-rule points breakdown and mismatch tracking.
- `bindTooltips(resolver, root?)` (`TooltipHost.ts` + `TooltipContext.ts`): Delegated `[data-tooltip-type]` hover/click host rendering into a shared `.tooltip-overlay`.

### 4.3 Dark / Light Mode Architecture
1. **Observable Theme State**: `MapState` tracks `theme: "light" | "dark" | "system"` (defaulting to `"system"`), persisted independently to `localStorage` key `ingress-shards-map:theme:v1`.
2. **Semantic Design Tokens**: A `data-theme="light"` or `data-theme="dark"` attribute on `document.documentElement` switches CSS custom properties (`--bg-primary`, `--text-primary`, `--color-border`) sourced from Core's `tokens.css`.
3. **Base Map Synchronization**: Switching theme automatically aligns the default base map tile set (*CartoDB Dark Matter* for dark, *CartoDB Positron* for light) only when no manual base layer preference has been set.

---

## 4. Feature Consolidation Matrix

| Area | V1 Map Implementation | V2 Core Replacement | Notes |
| :--- | :--- | :--- | :--- |
| **Geocoding & Location Cache** | `scripts/geocode.py`, `requirements.txt`, `cache.sqlite` | `@ingress-shards/ingress-events-core/conf/season_geocode.json` | **Completely eliminated in Map.** Geocoding is maintained upstream in Core with CI sqlite cache. Map drops Python toolchain and cache. |
| **Event Timeline & Durations** | Custom minute calculations in `event-helpers.js` | `SiteTimeline.activeDurationMinutes` & `getSiteActiveDurationMinutes()` | Precalculated in Core's `ConfigRegistry`. Direct property read. |
| **Event Configuration** | `conf/event_blueprints.json`, `conf/series_metadata.json` | `ConfigRegistry`, `@ingress-shards/ingress-events-core/conf/*` | Centralized singleton in `src/config/EventConfig.ts`. Direct typed access. |
| **Data Store & Cache** | `src/js/data/data-store.js` (series-centric) | `src/data/SeasonDataStore.ts` (season-centric) | Typed runtime cache storing `SeasonConfig` and lazily fetching `data/{seasonId}.json`. No legacy aliases. |
| **Data Processing** | `src/js/data/shard-jumps/data-processor.js` | `DataIngestionPipeline`, `SiteStateMerger`, `DefaultPortalMergeStrategy` | Tested portal merging, deduplication, and telemetry adapters. |
| **Scoring Calculations** | Custom logic in `data-processor.js` | `TargetScoringEngine`, `LinkScoringEngine` | Strict adherence to official Anomaly and Skirmish blueprints. |
| **Jump & Path Building** | Custom loops in `data-processor.js` | `ShardJumpWindowBuilder`, `ShardPathBuilder` | Dynamic jump links and target absorption detection. |
| **Date & Time** | `src/js/shared/date-helpers.js` | `common/Date.ts` (functional `temporal-polyfill/fns`) | `formatDuration`, `parseTimestampFromFilename`, `parseZonedDateTime`. |
| **Math & Geo** | `src/js/shared/math-helpers.js` | `common/Geo.ts`, `common/Math.ts` | E6 integer coordinates, `haversineDistance`, centroids, bounding boxes. |
| **Visual Tokens & Styling** | Hardcoded colors in CSS & JS | `visuals/Colors.ts`, `visuals/index.css` | Canonical faction colors, tokens, and CSS variables. |
| **Scoring Table & Tooltips** | `site-renderer.js` (`renderTableScores`) | Core `display/` (`ScoringTable` & breakdown tooltips) | Elevating plugin's `ScoringTableComponent` to Core provides identical rich scoring tables in both siblings. |
| **In-Browser Uploads** | `src/js/ui/custom-file-handler.js` | `DataObservationAdapter` + `DataIngestionPipeline` | Custom JSON uploads execute the identical pipeline as build-time artifacts. |

---

## 5. Master Checklist

### Phase 1: Setup & Branching
- [x] Create long-lived integration branch `feat/v2-core-integration` from `main`
- [x] Add `.npmrc` configured for `@ingress-shards` on GitHub Packages
- [x] Centralize local synchronization in `ingress-events-core` (`scripts/sync-to-siblings.js`)
- [x] Install dependency `@ingress-shards/ingress-events-core` (`^0.8.2`)
- [x] Align `temporal-polyfill` to `^1.0.8` across all projects (and move to `peerDependencies` in Core)
- [x] Validate workspace build and scripts run cleanly with new dependency

### Phase 2: Configuration, Toolchain & TypeScript Setup
- [x] Add geocode database cache step to `ingress-events-core/.github/workflows/release.yml`
- [x] Add `activeDurationMinutes` to `SiteTimeline` in Core (`SiteConfig.ts`) and expose `getSiteActiveDurationMinutes` on `ConfigRegistry`
- [x] Stash Denver target portal fix (`data/2026-apollo/target-portals_2026-apollo-denver-co_2026.09.20.00.26.26.json`) for separate `main` patch
- [x] Install `typescript` (^5.9.3), `ts-loader`, `@types/node` and configure `tsconfig.json` with `allowJs: true`
- [x] Update `webpack.common.js` to resolve `.ts` and compile via `ts-loader` with extension aliases
- [x] Remove Python geocoding pipeline (`scripts/geocode.py`, `requirements.txt`, `cache.sqlite`)
- [x] Add fast Node flag asset generator (`scripts/generate-flag-assets.js`) emitting `flag-icons.css` and copying active SVGs
- [x] Mark `gen/series_geocode.json` bridge generation as `@deprecated` in `generate-flag-assets.js`
- [x] Migrate `src/js/data/data-store.js` to `src/data/SeasonDataStore.ts`:
  - Adopt `season` terminology (`cache`, `getSeasonData`, `getAllSeasonIds`, etc.)
  - Streamline as pure telemetry cache with no constructor, no `init()`, and no config dependency
  - Replace `loadSeasonData` with `getSeasonData` returning `Promise<SiteStateMap>` (throwing descriptive error on failure, deduplicating inflight requests)
  - Provide unified cache-first `getSiteData(seasonId, siteId)` (retrieving telemetry if not cached)
  - Completely eliminate backward-compatibility aliases (`loadSeriesData`, etc.)
  - Replace `shardComponents` with `components` (later aligned to `events` / `SeasonEvent` in Core)
- [x] Delete `src/js/shared/event-helpers.js` and call `getConfigRegistry().getSiteActiveDurationMinutes(...)` directly
- [x] Update UI callers ([`ui-controller.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/ui-controller.js), [`series-renderer.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/series-renderer.js), [`site-renderer.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/site-renderer.js), [`custom-file-handler.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/custom-file-handler.js), [`index.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/index.js)) to call `SeasonDataStore` season methods directly
- [x] Update loaders and legacy scripts to use `events` (`SeasonEvent`) instead of `shardComponents`
- [x] Run full `npm run validate` pass

### Phase 3: Offline Data Pipeline & Pre-processor Migration
- [x] Add `tsx` devDependency to `package.json` for running TypeScript CLI scripts
- [x] Streamline data pipeline into `scripts/process-season-data.ts`:
  - Chronological file staging: `ornamented-portals-*` (Stage 1) → `target-portals-*` (Stage 2) → `shard-jump-times-*` (Stage 3, timestamp-sorted)
  - Pre-initialize accumulator `Map<SiteId, SiteState>` from `ConfigRegistry`
  - Ingest and analyze all season sites natively using Core's `DataIngestionPipeline` and `SiteStateAnalyser`, emitting `gen/data/<seasonId>.json` (`Record<SiteId, SiteState>`)
  - Consolidate validation anomalies (`invalidActions`, `mismatchedMoves`, `mismatchedScoringJumps`, `extendedJumpWindows`) directly into `SiteState.analysis.statistics` and `ShardJumpWindow`
  - Permanently retire legacy CSV reports (`actions-outside-window.csv`, `invalid-shard-sequences.csv`, `link-alignment-mismatches.csv`, `site-statistics.csv`, `validation-summary.json`) and delete `scripts/validation/`, standalone loaders, and `conf/series_metadata.json`
- [x] Update `package.json` scripts (`data:process`, `prepare:data`, `validate`) to invoke TypeScript pipeline via `tsx`
- [x] Update `SeasonDataStore.ts` to bridge `SiteState` / `SiteAnalysis` shapes for legacy UI renderers (`site-renderer.js`, `series-renderer.js`) until Phase 5
- [x] Align `json-parser-worker.js` / custom file processing to import Core `DataIngestionPipeline` directly and remove deprecated `getEventConfigRegistry()` alias
- [x] Align semantic domain terminology (`SiteState`, `SiteTelemetry`, `ConfigRegistry`, `HostSite`, `SeasonEvent`) across Core, Plugin, and Map
- [x] Prune `@deprecated` `gen/series_geocode.json` bridge generation from `generate-flag-assets.js`
- [x] Completely delete `src/js/data/shard-jumps/` directory (`data-processor.js`, `data-helpers.js`, `data-validator.js`, `data-statistics.js`)
- [x] Optimize `release.yml`: remove obsolete `processed-data` and `validation-reports` uploads (retaining Pages deployment)
- [x] Run full `npm run validate` pass

### Phase 4: Shared Utility & Constants Pruning
- [x] Replace `src/js/shared/math-helpers.js` usages with Core `Geo`
- [x] Replace hardcoded palettes in `constants.js` with canonical exports from `@ingress-shards/ingress-events-core`
- [x] Replace `event-helpers.js` with direct reads of `siteConfig.timeline.activeDurationMinutes`
- [x] Deprecate/prune `constants.js` once UI renderers reference Core directly

### Phase 4a: Glue & Infrastructure Review & TypeScript Migration
- [x] Add `@types/leaflet` (`devDependency`), create `src/types/ambient.d.ts` (Webpack globals, CSS/asset imports, untyped Leaflet plugins), and update `webpack.common.js` entry to `./src/index.ts`
- [x] Implement typed observable `MapState` (`src/state/MapState.ts`) for view and layer visibility state with independent `localStorage` persistence
- [x] Review, improve, and migrate `src/js/index.js` → `src/index.ts` (explicit composition root wiring `ConfigRegistry`, `SeasonDataStore`, `AppStore`, input tracking, map, UI, and router)
- [x] Review, improve, and migrate `src/js/router.js` → `src/routing/Router.ts` (bind hash & history changes directly to `AppStore`, clean back-navigation detection)
- [x] Review, improve, and migrate `src/js/ui/event-handler.js` → `src/ui/touchSupport.ts` (replace `window.*` touch/timer globals with typed module state, review touch/mouse suppression)
- [x] Review, improve, and migrate `src/js/ui/map/map-manager.js` → `src/ui/map/MapManager.ts` (map/pane initialization, base layers, relief/elevation legend lifecycle)
- [x] Review, improve, and migrate `src/js/ui/ui-controller.js` → `src/ui/UIController.ts` (subscribe to `MapState`, consolidate `displaySiteDetails` / `displayWaveDetails` duplication, layer cleanup, scoped event delegation)
- [x] Run full `npm run validate` pass

### Phase 5a: Core Display & Tooltip Elevation (`ingress-events-core`)
- [x] Review and migrate date & countdown formatting utilities from `src/js/shared/date-helpers.js` into `@ingress-shards/ingress-events-core` (`src/common/Date.ts` / `src/common/Locale.ts`)
- [x] Elevate `ScoringTableComponent` from IITC plugin into `@ingress-shards/ingress-events-core` (`src/display/ScoringTable.ts` & `src/visuals/display.css`)
- [x] Elevate unified tooltip renderers and `TooltipHost` into `@ingress-shards/ingress-events-core` (`src/display/tooltips/`):
  - Site tooltip (`SiteTooltip.ts`)
  - Portal tooltip (`PortalTooltip.ts` — portal title, Intel link, ornament label, shard telemetry history)
  - Path tooltip (`PathTooltip.ts` — link & random teleport origin/destination, distance, timestamps, moves, awarded points)
  - Wave summary (`WaveTooltip.ts`), Goal breakdown (`GoalScoringTooltip.ts`), and Link scoring breakdown (`LinkScoringTooltip.ts`) popover content + shared `TooltipHost.ts` (`bindTooltips`) and `TooltipContext.ts`
- [x] Align jump window duration display (`actualEnd - scheduledStart`) and formatting inside Core tooltips
- [x] Sync/release Core to siblings and verify `iitc-plugin-site-observer` and `ingress-shards.github.io` consume the elevated display exports

### Phase 5b-1: Leaf Utilities, Marker Templates & Panes
- [x] Elevate `renderFlagIcon(countryCode?)` into `ingress-events-core` (`src/visuals/templates/FlagIcon.ts`), adopt in `SiteTooltip.ts`, and delete `src/js/ui/ui-formatters.js`
- [x] Standardize Core SVG templates (`src/visuals/templates/`) on CSS-variable-driven `render*` functions (`renderSiteMarker`, `renderExportIcon`, `renderOrnamentIcon`, `renderOrnamentPortal`, `renderTargetOrnament`) with zero inline styles and unit tests
- [x] Replace `src/js/ui/marker-template.js` usages with Core's `renderSiteMarker` and `renderOrnamentPortal`, then delete `marker-template.js`
- [x] Export typed `MAP_PANES` constants (`ornamentPane`, `ornamentFrontPane`, `targetPane`, `shardPane`) in `MapManager.ts`
- [x] Import Core `visuals/visuals.css` in `src/index.ts` and remove duplicated marker/radar CSS rules from `src/assets/main.css`

### Phase 5b-2: Elevation Overlay Refactor
- [ ] Extract pure Terrarium/color/hillshade math into `src/ui/map/elevationMath.ts` with unit tests (`decodeTerrariumElevation`, `hsvToRgb`, `elevationRatioToRgb`, `computeHillshadeIntensity` with `pixelSizeMeters`, `sampleElevationGrid`)
- [ ] Extract `ElevationLegend` into `src/ui/map/ElevationLegend.ts`
- [ ] Refactor `src/ui/map/ElevationOverlay.ts` to sample DEM data directly inside `_fillHillshadeTile` (single fetch per tile), evict `tileRangeCache` on `tileunload`, and remove shadowed `leaflet-relief` stubs from `src/types/ambient.d.ts`
- [ ] Delete `src/js/ui/map/elevation.js` (including unused `getElevationForLatLng` dead code)

### Phase 5b-3: Theming Engine & Base-Layer Sync
- [ ] Add dark-default surface tokens and `:root[data-theme="light"]` overrides to Core `tokens.css` (plus `--bg-header` token in `display.css`)
- [ ] Review Core `src/visuals/Colors.ts` declarations (`ALIGNMENT_COLORS`, deprecated `FACTION_COLORS`, `UI_COLORS`) alongside `tokens.css` to prune unused or redundant color constants
- [ ] Add `theme: "light" | "dark" | "system"` (default `"system"`) to `MapState` (`src/state/MapState.ts`) with `subscribeTheme`, unsubscribe callbacks, independent `localStorage` persistence (`ingress-shards-map:theme:v1`), and unit tests
- [ ] Add `ThemeManager` (`src/ui/ThemeManager.ts`) resolving `"system"` via `matchMedia`, setting `document.documentElement.dataset.theme`, and notifying subscribers on OS/preference changes
- [ ] Wire `MapManager.ts` to auto-swap default base map (*CartoDB Dark Matter* ↔ *CartoDB Positron*) on resolved theme changes only when no manual `baseLayer` preference has been set
- [ ] Refactor hardcoded colors in `src/assets/main.css` (details panel, elevation legend, Leaflet controls/tooltips/popups) to consume semantic CSS tokens

### Phase 5c: Details Panel & Scoring Views in TypeScript
- [ ] Finalize `lit-html` vs framework-free TS decision for stateful panel components (aligning Map Phase 5c and Plugin Phase 6)
- [ ] Migrate `src/js/ui/details-panel.js` → `src/ui/details/DetailsPanel.ts` (typed `L.Control` subscribing to `MapState` and theme)
- [ ] Integrate Core's elevated `ScoringTable` and `ShardJumpGrouper` into the details panel
- [ ] Drive score rendering natively from `SiteState` / `SiteAnalysis` (omit scores when wave states are absent or season points are not required, removing the legacy `SeasonDataStore` `fullEvent.scores` bridge and `getScoresText` pre-event workaround)
- [ ] Wire interactive Wave summary, Goal, and Link scoring breakdown popover tooltips

### Phase 5d: Season & Site Map Layers (Geographic Canvas)
- [ ] Migrate `src/js/ui/series-renderer.js` → `src/ui/layers/SeasonLayer.ts` (rendering tactical markers, radar sweep, and status phases from `SiteState` & `SitePhase`)
- [ ] Migrate `src/js/ui/site-renderer.js` → `src/ui/layers/SiteLayer.ts` & `WaveLayer.ts` (rendering portals, target portals, and `analysis.shardPaths` directly)
- [ ] Bind Core's elevated portal and link tooltip formatters to map markers and polylines
- [ ] Review `UIController.ts` once views subscribe to `MapState` directly (slim down to shared viewport/camera/title coordination)
- [ ] Evaluate stripping `ShardMove.scoredRules` from serialized season JSON (retaining only `totalPoints`)

### Phase 5e: UI Controls Consolidation & Theme Switcher
- [ ] Design and implement consolidated map controls / settings menu (e.g., hamburger/gear menu absorbing base maps, overlays, theme switcher, and GitHub/about link to declutter map corners on desktop and mobile)
- [ ] Wire interactive Theme switcher (`System` / `Dark` / `Light`) to `MapState`

### Phase 5f: Custom File Ingestion (Isolated Sub-Phase)
- [ ] Migrate `src/js/ui/custom-file-handler.js` → `src/ui/custom/CustomFileHandler.ts`
- [ ] Replace `src/js/data/json-parser-worker.js` with a typed TypeScript worker using Core's `DataObservationAdapter` and `DataIngestionPipeline`
- [ ] Retire legacy ad-hoc fragment clustering (`getCoordsForFragment`, `getFragmentSpawnTimeMs`, `calculateCentroid`) and wire custom site registration into `ConfigRegistry`

### Phase 5g: Final Legacy Pruning & Zero-JS Cutover
- [ ] Remove `adaptSiteStateToLegacy` and `@deprecated` transitional methods from `SeasonDataStore.ts`
- [ ] Delete all remaining files under `src/js/` (`site-renderer.js`, `series-renderer.js`, `date-helpers.js`, etc.) and remove `src/js/`
- [ ] Set `"allowJs": false` in `tsconfig.json` and run full `npm run validate` pass

### Phase 6: Semantic Parity Verification & Testing
- [ ] Implement `scripts/verify-v1-v2-parity.ts` checking the 5 Domain Invariants
- [ ] Run parity checks across all historical seasons (`2024-erasedmem` through `2026-apollo`)
- [ ] Visual regression testing on Anomaly, Skirmish, and StandBy archetype sites
- [ ] **Plugin UI Component Review (`iitc-plugin-site-observer`)**: Review `SiteTableComponent` and sibling UI components (`ToolsMenuComponent`, `ObserverView`, and UI hosts/controls) for refactoring and code-quality improvements:
  - Decompose oversized components (e.g., `SiteTableComponent` >300 lines) and separate phase/status view-model logic from HTML template rendering and jQuery DOM wiring
  - Audit DOM state attributes (e.g., `data-actual-shards`, `data-has-ornaments`) and event listener lifecycles (e.g., cleaning up `window` listeners on `ObserverView` unmount)
  - Align rendering, state handling, and shared Core display usage with patterns established in Phase 5

### Phase 7: Release & Cutover to V2
- [ ] Final `npm run validate` pass
- [ ] PR from `feat/v2-core-integration` to `main`
- [ ] Tag `v2.0.0` via Conventional Commits
- [ ] Verify GitHub Pages deployment
