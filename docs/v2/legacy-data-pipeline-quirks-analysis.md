# Technical Analysis: Legacy Data Pipeline Quirks & Optimization Strategy

## 1. Executive Summary
During the Phase 3 migration of the offline data ingestion pipeline to `@ingress-shards/ingress-events-core`, achieving 100% bit-for-bit parity across all 6 diagnostic reports required reverse-engineering 4 undocumented legacy data quirks. 

This document breaks down each quirk in detail—what happened, why it broke modern typed models, how it was resolved, and the architectural review decisions for each—followed by concrete mechanisms to prevent similar time sinks in future phases.

---

## 2. Deep Dive: The 4 Legacy Data Pipeline Quirks

### Quirk 1: Niantic Multi-Wave Shard Re-use
- **Event Context:** Observed prominently in `2026-apollo` (Helsinki) and select historical anomaly sites.
- **The Telemetry Pattern:** In Niantic's raw shard jump logs (`shard-jump-times-*.json`), fragment IDs (e.g., `abaddon1_1` or `1`) were reused across multiple waves. Specifically, shard `1` spawned in Wave 1, despawned, and then hours later in Wave 3, a second `spawn` entry appeared for fragment `1` with fresh jumps.
- **Why It Broke Modern Code:** Modern domain entity models assume a 1:1 relationship between a `Shard` entity and its lifecycle (`spawn` ➔ `jumps` ➔ `despawn`/`captured`). When the ingestion pipeline initially treated shard `1` as a single continuous shard, the Wave 3 jumps were merged into Wave 1. As a result, Helsinki reported only 69 shards instead of the expected 138 wave shards, producing false-positive "missing shard" anomalies.
- **Phase 3 Resolution:** In `SiteAdapter.ts` and `SeasonDataStore.ts`, shard histories containing multiple `spawn` actions are split into distinct wave instances (`shard 1 (wave 1)`, `shard 1 (wave 3)`).
- **Review Decision Points:**
  1. *Core Model Enhancement:* Should `@ingress-shards/ingress-events-core` natively support compound wave-shard identifiers (e.g., `<shardId>_<waveNumber>`) during initial ingestion, rather than splitting at adapter boundaries?
  2. *Historical Scope:* Confirm whether any other historical seasons exhibit non-standard fragment re-use.

---

### Quirk 2: Single-Wave Skirmish Schema Invariant (`waves: undefined`)
- **Event Context:** Skirmish events (e.g. `2026-cygnus`, `2025-plusbeta`, `2025-plustheta`).
- **The Telemetry Pattern:** Skirmishes do not feature scheduled multi-wave jump windows (waves 1 to 6). In legacy `main`, `site.waves` was strictly `undefined` for skirmish sites, whereas multi-wave Anomaly sites had `site.waves = [...]`.
- **Why It Broke Modern Code:** In TypeScript, models naturally favor empty arrays (`waves: []`) or 1-element arrays over `undefined`. However, the legacy validation engine evaluated:
  ```javascript
  if (site.waves && shardMechanic.waves) { ... }
  ```
  If `site.waves` was defined on a skirmish, the validator attempted to match its jumps against the multi-wave Anomaly timetable from `event_blueprints.json`. Because skirmishes follow different timings, this generated over 100 false-positive "actions outside window" and "missing action" errors.
- **Phase 3 Resolution:** Guarded wave generation with:
  ```typescript
  const waves = (timelineWaves && timelineWaves.length > 1) ? ... : undefined;
  ```
- **Review Decision Points:**
  1. *Schema Explicit-ness:* In V2, should we replace the implicit `site.waves === undefined` flag with an explicit property (e.g. `site.archetype: "anomaly" | "skirmish" | "standby"`)?
  2. *Validator Decoupling:* Should the validator inspect `siteConfig.eventType` instead of checking if `site.waves` exists on the observation record?

---

### Quirk 3: Legacy Statistics Fencepost Error & Absolute Latencies
- **Event Context:** Calculated across all seasons in `gen/reports/site-statistics.csv`.
- **The Mathematical Pattern:**
  1. *Average Interval:* In standard time-series statistics, the mean interval between $N$ timestamped actions over a timespan $\Delta t$ is:
     $$\text{Avg Interval} = \frac{\Delta t}{N - 1}$$
     The legacy `data-statistics.js` script divided by $N$ (`spanMs / stats.times.length`), introducing a classic fencepost calculation error.
  2. *Average Latency:* Legacy code summed `Math.abs(diffMs)` divided by $N$, calculating mean absolute deviation rather than signed latency.
- **Why It Broke Parity:** For a wave with 3 spawns over 21 seconds, the correct mathematical interval is `10.5s` ($\frac{21}{2}$), but baseline `main` reported `7.0s` ($\frac{21}{3}$).
- **Phase 3 Resolution:** Replicated the legacy divisor (`spanMs / count`) and absolute latency (`Math.abs(diff)`) in `Statistics.ts` to achieve exact bit-for-bit parity with the baseline CSV.
- **Review Decision Points:**
  1. *Bug-Compatibility vs. Correct Math:* Should V2 retain the legacy formula for 100% historical report parity, or fix the math to $\frac{\Delta t}{N - 1}$ with an explicit note in the migration documentation?

---

### Quirk 4: Wave Index Resolution for Alignment Mismatches
- **Event Context:** `gen/reports/link-alignment-mismatches.csv` (specifically rows involving multi-wave shards, e.g. Perth in `2025-plustheta`).
- **The Look-up Pattern:** When reporting a link alignment mismatch (where link faction $\neq$ anchor portal faction), the legacy validator resolved the `Wave` number with:
  ```javascript
  const waveIndex = site.waves ? site.waves.findIndex(w => w.shards.some(s => s.id === mismatch.shardId)) : -1;
  ```
- **Why It Broke Parity:** When a shard survived and jumped across multiple waves, `.findIndex()` stopped at the *first* wave where the shard ID was found (e.g. Wave 1), even if the alignment mismatch occurred during Wave 6. A modern timestamp-based lookup correctly assigned Wave 6, creating a difference against baseline line 475.
- **Phase 3 Resolution:** Replicated the `.findIndex()` logic in `Validator.ts`.
- **Review Decision Points:**
  1. *Diagnostic Accuracy:* Should mismatches record the actual wave index of the move timestamp, rather than the initial spawn wave?

---

## 3. Strategies to Ensure Future Tasks Take Less Time

### Strategy A: Explicit Parity Definitions (Semantic vs. Bit-for-Bit)
- **The Problem:** Hunting down fencepost calculation bugs (`7.0s` vs `10.5s`) and first-wave lookups accounted for ~60% of the debugging time.
- **The Solution:** For future tasks, establish upfront whether the acceptance criterion is:
  1. **Semantic Parity (Recommended for UI & Logic):** Domain invariants hold; scores, timeline progression, faction markers, and telemetry match exactly.
  2. **Bit-for-Bit Parity (Strict Diagnostic Parity):** Output strings and CSV files must match legacy files line-for-line, requiring deliberate replication of legacy bugs.

### Strategy B: Sub-Pipeline Isolated Test Fixtures
- **The Problem:** Running the full 10-season pipeline takes ~15–20 seconds per iteration.
- **The Solution:** Create targeted micro-fixtures:
  - `fixtures/helsinki-reuse.json` (tests multi-wave shard re-use in <100ms)
  - `fixtures/perth-mismatch.json` (tests alignment mismatch resolution in <100ms)
  Running a 100ms fixture instead of a 20s full run reduces iteration cycles by a factor of 200.

### Strategy C: Time-Box & Escalation Guardrail (Early Exit Rule)
To prevent the agent from spending hours in autonomous retry loops, we can add a formal rule to `.agent/rules/standards.md`:

```markdown
## Parity Investigation & Time-Box Rule
- **Time-Box Threshold:** If an investigation or parity-debugging loop exceeds 15 minutes or 3 consecutive iterations trying to reconcile differences against a legacy script:
  1. **Halt execution:** Do not continue guessing or mutating core logic.
  2. **Isolate the delta:** Output a side-by-side comparison of the difference (e.g. Expected: `7.0s` via `duration / N`, Actual: `10.5s` via `duration / (N - 1)`).
  3. **Escalate to user:** Ask whether the difference represents an intended modern correction or if legacy bug-compatibility is strictly required.
```

---

## 4. Proposed Review Workflow
We will review each quirk one at a time:
1. **Review Quirk 1 (Shard Re-use):** Decide whether to handle in Core ingestion or keep in boundary adapters.
2. **Review Quirk 2 (Skirmish Schema):** Decide on explicit `site.archetype` vs `waves: undefined`.
3. **Review Quirk 3 (Statistics Math):** Decide on legacy bug-compatibility vs standard $\frac{\Delta t}{N - 1}$.
4. **Review Quirk 4 (Mismatch Wave Lookups):** Decide on timestamp-based wave matching vs first-seen wave matching.
5. **Enact Time-Box Rule in `standards.md`:** Add the early-exit guardrail to project rules.
