# Ingress Shard Map V2 Migration Plan

## 1. Overview & Objectives

Version 2 of the Ingress Shard Map re-platforms the project to consume [`@ingress-shards/ingress-events-core`](file:///c:/Users/Lewis/git/yeggs-github/ingress-events-core) as an external dependency and progressively adopts **TypeScript** to achieve end-to-end type safety across the entire ecosystem.

### Core Goals:
- **Single Source of Truth**: Eliminate duplicated event mechanics, blueprints, scoring logic, and configuration between the shard map and IITC plugin.
- **Mature Data Pipeline**: Replace the legacy 33 KB monolithic `data-processor.js` with Core's unit-tested processors (`SiteDataProcessor`, `SiteRecordMerger`, `DefaultPortalMergeStrategy`, `WaveShardJumpBuilder`, `ShardPathBuilder`).
- **End-to-End TypeScript Alignment**: Transition the Map application to TypeScript incrementally, consuming Core's strict domain models (`SiteConfig`, `EventTimeline`, `SeasonConfig`, `SiteRecord`) with zero runtime shape ambiguity.
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
[Phase 2: Hybrid Setup] ──> [Phase 3: Pipeline in TS] ──> [Phase 4-5: UI in TS] ──> [100% Strict TS]
 tsconfig (allowJs: true)     Loaders & adapters in TS     New UI renderers in TS    Legacy .js pruned
 EventConfig.ts, DataStore.ts Prune data-processor.js      Prune legacy renderers    100% type-checked
```

1. **Phase 2 (Tooling & Core Layer):**
   - Install `typescript` (^5.9.3), `ts-loader`, `@types/node`.
   - Add `tsconfig.json` with `"allowJs": true`, `"checkJs": false`, `"strict": true`, and `"moduleResolution": "bundler"`.
   - Configure `webpack.common.js` with `ts-loader` and `.ts` extension resolution / extension aliases.
   - Author new/migrated configuration and data store layers in TypeScript directly under `src/<domain>/` (`src/config/EventConfig.ts`, `src/data/DataStore.ts`).
   - Legacy JavaScript files (`data-processor.js`, `site-renderer.js`, etc.) remain in `src/js/` undisturbed.
2. **Phase 3 (Offline Data Pipeline):**
   - Author offline loaders and adapters in TypeScript (`scripts/pre-processor-loader.ts`, `scripts/validator-loader.ts`, `scripts/statistics-loader.ts`).
   - Delete legacy 33 KB `data-processor.js` (saving dozens of hours that would otherwise be wasted typing obsolete code).
3. **Phase 4 & 5 (UI & Display Components):**
   - Author new modern UI components and scoring displays natively in TypeScript.
   - Delete legacy Leaflet DOM renderers (`site-renderer.js`, `series-renderer.js`).
4. **Phase 7 (Release):**
   - Entire codebase is 100% TypeScript with complete compile-time type safety.

---

## 4. Feature Consolidation Matrix

| Area | V1 Map Implementation | V2 Core Replacement | Notes |
| :--- | :--- | :--- | :--- |
| **Geocoding & Location Cache** | `scripts/geocode.py`, `requirements.txt`, `cache.sqlite` | `@ingress-shards/ingress-events-core/conf/season_geocode.json` | **Completely eliminated in Map.** Geocoding is maintained upstream in Core with CI sqlite cache. Map drops Python toolchain and cache. |
| **Event Timeline & Durations** | Custom minute calculations in `event-helpers.js` | `EventTimeline.durationMinutes` & `getSiteDurationMinutes()` | Precalculated in Core's `EventConfigRegistry`. Direct property read. |
| **Event Configuration** | `conf/event_blueprints.json`, `conf/series_metadata.json` | `EventConfigRegistry`, `@ingress-shards/ingress-events-core/conf/*` | Centralized singleton in `src/config/EventConfig.ts`. Direct typed access. |
| **Data Store & Cache** | `src/js/data/data-store.js` (series-centric) | `src/data/DataStore.ts` (season-centric) | Typed runtime cache storing `SeasonConfig` and lazily fetching `data/{seasonId}.json`. No legacy aliases. |
| **Data Processing** | `src/js/data/shard-jumps/data-processor.js` | `SiteDataProcessor`, `SiteRecordMerger`, `DefaultPortalMergeStrategy` | Tested portal merging, deduplication, and observation adapters. |
| **Scoring Calculations** | Custom logic in `data-processor.js` | `GoalScoringEngine`, `LinkScoringEngine` | Strict adherence to official Anomaly and Skirmish blueprints. |
| **Jump & Path Building** | Custom loops in `data-processor.js` | `WaveShardJumpBuilder`, `ShardPathBuilder` | Dynamic jump links and target absorption detection. |
| **Date & Time** | `src/js/shared/date-helpers.js` | `common/Date.ts` (functional `temporal-polyfill/fns`) | `formatDuration`, `parseTimestampFromFilename`, `parseZonedDateTime`. |
| **Math & Geo** | `src/js/shared/math-helpers.js` | `common/Geo.ts`, `common/Math.ts` | E6 integer coordinates, `haversineDistance`, centroids, bounding boxes. |
| **Visual Tokens & Styling** | Hardcoded colors in CSS & JS | `visuals/Colors.ts`, `visuals/index.css` | Canonical faction colors, tokens, and CSS variables. |
| **Scoring Table & Tooltips** | `site-renderer.js` (`renderTableScores`) | Core `display/` (`ScoringTable` & breakdown tooltips) | Elevating plugin's `ScoringTableComponent` to Core provides identical rich scoring tables in both siblings. |
| **In-Browser Uploads** | `src/js/ui/custom-file-handler.js` | `DataObservationAdapter` + `SiteDataProcessor` | Custom JSON uploads execute the identical pipeline as build-time artifacts. |

---

## 5. Master Checklist

### Phase 1: Setup & Branching
- [x] Create long-lived integration branch `feat/v2-core-integration` from `main`
- [x] Add `.npmrc` configured for `@ingress-shards` on GitHub Packages
- [x] Centralize local synchronization in `ingress-events-core` (`scripts/sync-to-siblings.js`)
- [x] Install dependency `@ingress-shards/ingress-events-core` (`^0.8.2`)
- [x] Pin `temporal-polyfill` to `~1.0.5` across all projects
- [x] Validate workspace build and scripts run cleanly with new dependency

### Phase 2: Configuration, Toolchain & TypeScript Setup
- [x] Add geocode database cache step to `ingress-events-core/.github/workflows/release.yml`
- [x] Add `durationMinutes` to `EventTimeline` in Core (`SeasonConfig.ts`) and expose `getSiteDurationMinutes` on `EventConfigRegistry`
- [x] Stash Denver target portal fix (`data/2026-apollo/target-portals_2026-apollo-denver-co_2026.09.20.00.26.26.json`) for separate `main` patch
- [x] Install `typescript` (^5.9.3), `ts-loader`, `@types/node` and configure `tsconfig.json` with `allowJs: true`
- [x] Update `webpack.common.js` to resolve `.ts` and compile via `ts-loader` with extension aliases
- [x] Remove Python geocoding pipeline (`scripts/geocode.py`, `requirements.txt`, `cache.sqlite`)
- [x] Add fast Node flag asset generator (`scripts/generate-flag-assets.js`) emitting `flag-icons.css` and copying active SVGs
- [x] Mark `gen/series_geocode.json` bridge generation as `@deprecated` in `generate-flag-assets.js`
- [x] Migrate `src/js/data/data-store.js` to `src/data/SeasonDataStore.ts`:
  - Adopt `season` terminology (`cache`, `getSeasonData`, `getAllSeasonIds`, etc.)
  - Streamline as pure telemetry cache with no constructor, no `init()`, and no config dependency
  - Replace `loadSeasonData` with `getSeasonData` returning `Promise<SiteRecordMap>` (throwing descriptive error on failure, deduplicating inflight requests)
  - Provide unified cache-first `getSiteData(seasonId, siteId)` (retrieving telemetry if not cached)
  - Completely eliminate backward-compatibility aliases (`loadSeriesData`, etc.)
  - Replace `shardComponents` with `components`
- [x] Delete `src/js/shared/event-helpers.js` and call `getEventConfigRegistry().getSiteDurationMinutes(...)` directly
- [x] Update UI callers ([`ui-controller.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/ui-controller.js), [`series-renderer.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/series-renderer.js), [`site-renderer.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/site-renderer.js), [`custom-file-handler.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/ui/custom-file-handler.js), [`index.js`](file:///c:/Users/Lewis/git/yeggs-github/ingress-shards.github.io/src/js/index.js)) to call `SeasonDataStore` season methods directly
- [x] Update loaders and legacy scripts to use `components` instead of `shardComponents`
- [x] Run full `npm run validate` pass

### Phase 3: Offline Data Pipeline & Pre-processor Migration
- [ ] Update `release.yml` step `Upload Processed Data Artifact` to upload `path: gen/data/`
- [ ] Refactor loaders to TypeScript: `pre-processor-loader.ts`, `validator-loader.ts`, `statistics-loader.ts`
- [ ] Replace `data-processor.js` with Core's `SiteDataProcessor`
- [ ] Prune `@deprecated` `gen/series_geocode.json` bridge generation from `generate-flag-assets.js`
- [ ] Prune `seriesList` bridge mappings from loader scripts
- [ ] Prune legacy `data-processor.js` and `data-helpers.js`

### Phase 4: Shared Utility & Constants Pruning
- [ ] Replace `src/js/shared/math-helpers.js` usages with Core `Geo`
- [ ] Replace `src/js/shared/date-helpers.js` usages with Core `Date` utilities
- [ ] Replace hardcoded palettes in `constants.js` with canonical exports from `@ingress-shards/ingress-events-core`
- [x] Replace `event-helpers.js` with direct reads of `siteConfig.timeline.durationMinutes`
- [ ] Deprecate/prune `constants.js` once UI renderers reference Core directly

### Phase 5: UI & Renderer Adaptation in TypeScript
- [ ] Elevate `ScoringTableComponent` and breakdown tooltip formatters from IITC plugin into `@ingress-shards/ingress-events-core` (`src/display/`)
- [ ] Author new modern UI components in TypeScript (`src/ui/`)
- [ ] Render waves, paths, and jumps from Core `SiteAnalysis`
- [ ] Integrate `ShardJumpGrouper` from Core into jump history UI
- [ ] Update `custom-file-handler.ts` to parse local user-dropped logs through `SiteDataProcessor`
- [ ] Delete legacy JavaScript renderers (`site-renderer.js`, `series-renderer.js`)

### Phase 6: Semantic Parity Verification & Testing
- [ ] Implement `scripts/verify-v1-v2-parity.ts` checking the 5 Domain Invariants
- [ ] Run parity checks across all historical seasons (`2024-erasedmem` through `2026-apollo`)
- [ ] Visual regression testing on Anomaly, Skirmish, and StandBy archetype sites

### Phase 7: Release & Cutover to V2
- [ ] Final `npm run validate` pass
- [ ] PR from `feat/v2-core-integration` to `main`
- [ ] Tag `v2.0.0` via Conventional Commits
- [ ] Verify GitHub Pages deployment
