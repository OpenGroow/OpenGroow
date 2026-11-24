# ADR-084: Publications reference their approved Run; recipe and family performance is derived from Recipe Snapshots and computed on read, within a bounded scan

**Status:** Proposed

## Context

Milestone 8.1 must tell how Production Recipes and Creative Families perform, from the Publications they produced. The chain Creative Family → Production Recipe → Mission (Recipe Snapshot) → Run → Publication → Performance Snapshots already exists except at one point: a Publication is one row per (Mission, Publish target) and does not say which Run produced what it sent. A Mission can have several Runs (retry, revision), and its latest result is not necessarily the one the human approved. Aggregates are also read by Agents through the Internal MCP (ADR-080), so they must be deterministic, bounded and honest about what they did not read.

## Decision

- **A Publication references the Run of its approved output.** A Mission records the Run that produced its result (`lastResultRunId`), written in the same mutation as the result. The Publication copies it when it is created, and updates it on a retry only when the output sent changes. Publications and Missions that predate it have none; there is no backfill and no "latest Run" fallback.
- **Attribution is read from the Recipe Snapshot, never copied or inferred.** The recipe is the snapshot's; the Creative Family is the recipe's. The snapshot is not modified (ADR-083). The invariant that makes this safe: **a Production Recipe never changes Creative Family**. It is documented and tested; if it ever changes, the family must be frozen at that time. A Publication without a snapshot is unattributed: it stays in the general analytics and in no recipe or family aggregate. A recipe or family that was archived stays attributed under its own identity.
- **Aggregates are computed on read, from Publications.** No table, no persisted aggregate. A family is computed from its Publications, never from the means of its recipes, and a Publication counts once per adapter. The existing `analytics_summary` is extended with a `groupBy` (platform, format, Mission type, recipe, family; the default output is unchanged), filters (platform, recipe, family) and a period (`days`, or `from` and `to`, at most 365 days). A group exists only if it has Publications. The Analytics Adapter contract is unchanged: every adapter's groupings can be read by recipe and family, each adapter on its own, with no total across adapters or platforms.
- **Per-metric figures keep their meaning.** Each declared metric gets its observation count, sum (counters), mean and median over the Publications that report it. A missing metric is absent, never zero. A ratio is reported both recomputed from the sums and as mean and median of per-Publication ratios, under different names. No score and no ranking across platforms. Freshness (oldest and newest reading) and Publication age are exposed.
- **A measured Publication has usable data**: at least one declared metric read. A Snapshot with no usable figure does not count.
- **The catalog stays separate from performance.** Recipes that never produced a Publication are not empty groups: they are read through a new Internal MCP tool, `list_production_recipes`, with their family and their Recipe usage (Missions, Production Attempts, successful ones, Publications, measured Publications, lifetime and period, each dated by its own event; `neverUsedEver` and `neverPublishedEver`). `get_analytics_summary` and `list_publications` are extended, not duplicated. The Analytics page shows marketing performance only, so it shows none of the usage counters and no unused recipe.
- **Reads are bounded and say so.** Publications are read newest-created first (the index order, the id breaking ties) and the read stops at 2,000 rows, so the limit bounds the database reads. When it is reached the answer carries `scanLimited`, `oldestScannedCreatedAt` and `partial`, and its totals are labelled partial. A Publication created before that date but published in the period can then be missing. Truncation of a list (`truncated`, `total`) is a separate signal from an incomplete scan. A lifetime flag is asserted only on sufficient evidence: `false` when use or publication was seen, `true` only when the read was complete, otherwise unknown. Mission and Run reads behind the counters follow the same rule.

## Considered options

- **Freezing the Creative Family in the Recipe Snapshot.** Rejected: a recipe never changes family, so a copy only adds a second source of truth; revisit if recipes become movable.
- **Persisted aggregates per recipe or family.** Rejected for 8.1: they need recomputation on every reading, and the volumes (a Project's Publications over a year) fit a bounded read. Revisit when the scan limit is hit in practice, with an index on the publication date first.
- **Deducing the Run from the Mission's latest Run.** Rejected: wrong as soon as a retry or a revision exists between approval and publication.
- **Restricting recipe and family views to adapters declaring "reliable attribution".** Rejected: the join is Publication → recipe, which comes from OpenGroow's data, not from the adapter; a URL-based adapter legitimately measures content produced with a recipe. No contract change.

## Consequences

- Two optional fields (`missions.lastResultRunId`, `publications.runId`) and no new table. Recipe-level history of old Publications is attributed through their Mission's snapshot where one exists; the Run is unknown for them.
- A Mission deleted drops out of the analytics, as it does today.
- The 2,000-row limit is a deliberate ceiling, visible to the Agent through `partial`; an index on the publication date is the next step only if it is reached.
- 8.2 (Strategic Reviews) and the Creative Agent read these figures through the Internal MCP without computing attribution themselves.
