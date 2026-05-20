# Date Handling & Temporal Polyfill Integration

This document defines the architecture, standard interfaces, and high-performance algorithms for date and time operations within the `ingress-shards.github.io` project.

---

## 1. Stack and Library Choice: `temporal-polyfill`
Following modern ECMAScript standards and project specifications, date-time processing in this project is built entirely on `temporal-polyfill`. 

### Key Standards:
- **Strict Tree-Shaking**: All modules MUST import functional APIs (e.g., `import * as ZonedDateTime from "temporal-polyfill/fns/zoneddatetime"`) rather than importing the full OO wrapper object, ensuring the final Webpack production bundle size remains as compact as possible.
- **Pure RFC 9557 Formats**: Standard ISO strings with bracketed timezone suffixes (e.g., `2026-05-20T21:50:32[Europe/Prague]`) are parsed directly via `ZonedDateTime.fromString()`. Hand-crafted string splitting (e.g., `.split('[')[0]`) is strictly deprecated.

---

## 2. High-Performance Date Processing ($O(N)$ vs $O(N \times M)$)
Parsing and creating date records is a computationally expensive process. In data processing cycles (such as shard jump and portal history aggregation), the date parsing code should NEVER reside within hot-path iterations.

### Core Architecture Pattern:
1. **Pre-computation**: Parse dates and timezone offsets **once** before entering any element processing loops.
2. **Epoch Milliseconds Comparison**: Map standard `ZonedDateTime` or `Instant` objects to their raw epoch millisecond values (e.g., via `ZonedDateTime.epochMilliseconds(zdt)`).
3. **Loop Logic**: Perform comparative logic using lightweight integer primitives (`epochMillis`) rather than calling parse utilities repeatedly.

Applying this pattern to the shard-jump data processor reduced execution times from **~33 seconds down to 0.87 seconds**.

---

## 3. Shared Helpers API
All standard helper functions reside in `src/js/shared/date-helpers.js`. These include:
- `createWaveDate`: Creates wave timing boundaries in a site's local timezone.
- `getTimeRemaining`: Evaluates current countdowns for upcoming event phases.
- `getActiveEventRemaining`: Evaluates active event window clocks.
- `formatIsoToShortDate`: Performs localized, timezone-aware calendar formatting.
