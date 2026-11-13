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
[Phase 1-2: Setup & TS] ──> [Phase 3: Pipeline] ──> [Phase 4: Utilities] ──> [Phase 4a: Glue in TS] ──> [Phase 5: UI in TS] ──> [Phase 6-7: Parity & Release]
 feat/v2-core-integration    process-season-data.ts  Prune math/constants     index, router, map,        New UI renderers in TS    verify-v1-v2-parity.ts
 EventConfig, SeasonDataStore Prune data-processor.js  (date-helpers -> Ph 5)   events, controller in TS   Prune legacy src/js/      100% strict TS, v2.0.0
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
   - Replace `event-helpers.js` with direct reads of `siteConfig.timeline.durationMinutes` via `ConfigRegistry`.
   - (`src/js/shared/date-helpers.js` migration is deferred to Phase 5 alongside UI formatting.)
5. **Phase 4a (Glue & Infrastructure Review & TypeScript Migration):**
   - Add `@types/leaflet` and ambient declarations (`src/types/ambient.d.ts`) for Webpack globals, CSS/asset imports, and untyped Leaflet plugins.
   - Review, improve, and migrate core glue modules (`index.ts`, `router.ts`, `event-handler.ts`, `map-manager.ts`, `ui-controller.ts`) to TypeScript before UI renderer refactoring.
6. **Phase 5 (UI & Renderer Adaptation in TypeScript):**
   - Elevate `ScoringTableComponent` and breakdown tooltip formatters from IITC plugin into Core (`src/display/`), and migrate `date-helpers.js` utilities into Core (`src/common/Date.ts` / `src/display/`).
   - Author new modern UI components and scoring displays natively in TypeScript (`src/ui/`).
   - Migrate remaining UI/map modules (`elevation.js`, `details-panel.js`, `ui-formatters.js`, `custom-file-handler.js`, `json-parser-worker.js`).
   - Delete legacy Leaflet DOM renderers and helpers (`site-renderer.js`, `series-renderer.js`, `marker-template.js`, `date-helpers.js`) and remove `src/js/`.
7. **Phase 6 (Semantic Parity Verification & Testing):**
   - Implement `scripts/verify-v1-v2-parity.ts` to verify the 5 Domain Invariants across all historical seasons (`2024-erasedmem` through `2026-apollo`) and perform visual checks on Anomaly, Skirmish, and StandBy archetype sites.
8. **Phase 7 (Release & Cutover to V2):**
   - Entire codebase is 100% TypeScript with complete compile-time type safety; run final `npm run validate`, merge `feat/v2-core-integration` to `main`, and cut `v2.0.0`.

---

## 4. Feature Consolidation Matrix

| Area | V1 Map Implementation | V2 Core Replacement | Notes |
| :--- | :--- | :--- | :--- |
| **Geocoding & Location Cache** | `scripts/geocode.py`, `requirements.txt`, `cache.sqlite` | `@ingress-shards/ingress-events-core/conf/season_geocode.json` | **Completely eliminated in Map.** Geocoding is maintained upstream in Core with CI sqlite cache. Map drops Python toolchain and cache. |
| **Event Timeline & Durations** | Custom minute calculations in `event-helpers.js` | `EventTimeline.durationMinutes` & `getSiteDurationMinutes()` | Precalculated in Core's `ConfigRegistry`. Direct property read. |
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
- [x] Add `durationMinutes` to `EventTimeline` in Core (`SeasonConfig.ts`) and expose `getSiteDurationMinutes` on `ConfigRegistry`
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
- [x] Delete `src/js/shared/event-helpers.js` and call `getConfigRegistry().getSiteDurationMinutes(...)` directly
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
- [x] Replace `event-helpers.js` with direct reads of `siteConfig.timeline.durationMinutes`
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

### Phase 5: UI & Renderer Adaptation in TypeScript
- [ ] Evaluate `lit-html` vs `Svelte` (vs framework-free TS) for Phase 5 UI rendering, templates, and event binding
- [ ] Elevate `ScoringTableComponent` and breakdown tooltip formatters from IITC plugin into `@ingress-shards/ingress-events-core` (`src/display/`)
- [ ] Review and migrate date & formatting utilities from `src/js/shared/date-helpers.js` into `@ingress-shards/ingress-events-core` (`src/common/Date.ts` / `src/display/`) to eliminate duplicate date logic between siblings and transition Map UI to pure Core utilities
- [ ] Author new modern UI components in TypeScript (`src/ui/`) and migrate `elevation.js`, `details-panel.js`, and `ui-formatters.js`
- [ ] Review `UIController.ts` once views subscribe to `MapState` directly (move view-specific rendering/events into views and either dissolve `UIController` or slim it down to shared viewport/camera/title coordination)
- [ ] Review Leaflet custom pane names (`ornamentPane`, `ornamentFrontPane`, `targetPane`, `shardPane`) for accuracy
- [ ] Render waves, paths, and jumps from Core `SiteAnalysis`
- [ ] Drive score rendering natively from `SiteState` / `SiteAnalysis` (omit scores when wave states are absent or season points are not required, removing the legacy `SeasonDataStore` `fullEvent.scores` bridge and `getScoresText` pre-event workaround)
- [ ] Integrate `ShardJumpGrouper` from Core into jump history UI
- [ ] Update `custom-file-handler.ts` and deprecate legacy `json-parser-worker.js` clustering helpers (`getCoordsForFragment`, `getFragmentSpawnTimeMs`, `calculateCentroid`) in favor of Core `DataObservationAdapter`
- [ ] Delete legacy JavaScript renderers and helpers (`site-renderer.js`, `series-renderer.js`, `marker-template.js`, `date-helpers.js`) and remove `src/js/`

### Phase 6: Semantic Parity Verification & Testing
- [ ] Implement `scripts/verify-v1-v2-parity.ts` checking the 5 Domain Invariants
- [ ] Run parity checks across all historical seasons (`2024-erasedmem` through `2026-apollo`)
- [ ] Visual regression testing on Anomaly, Skirmish, and StandBy archetype sites

### Phase 7: Release & Cutover to V2
- [ ] Final `npm run validate` pass
- [ ] PR from `feat/v2-core-integration` to `main`
- [ ] Tag `v2.0.0` via Conventional Commits
- [ ] Verify GitHub Pages deployment
