# ADR-085: Strategic Reviews are Jobs that accumulate a Strategic Memory, persisted as immutable versions against a base pinned at dispatch

**Status:** Proposed

## Context

Milestone 8.1 (ADR-084) measures how Production Recipes and Creative Families perform, but nothing keeps what was learned from those measurements. The Strategy Agent must analyze performance periodically and consolidate what it knows over time, without a new Agent, a vector store or structured insights, and without ever writing to OpenGroow itself (ADR-052, ADR-080). Two Runs can overlap, and a Run can last minutes while the data moves under it.

## Decision

- **A Strategic Review is a Job, not a Mission.** It is a Job type `strategic_review` of the Strategy Agent, run on the Job's own recurrence or with Run Now. Nobody triggers it as work to review and nobody approves it, which is what separates a Job from a Mission. Its Runs belong to the Job (`jobId`). It creates, launches or changes no Mission and no Production Recipe.
- **Its configuration is `analysisDays`** (integer, 1–365, default 30, on the Job's `config`). The frequency is the Job's recurrence, independent of it. Successive Reviews may overlap and a Publication is never excluded because an earlier Review read it.
- **OpenGroow pins the base and the period when the Run starts.** At dispatch Convex resolves `periodStart` and `periodEnd` from `analysisDays` and records, on the Run, the latest persisted Strategic Review as its **base**. Neither is ever read from what the Agent returns. The period reaches the Agent through a context provider; the Agent passes it as `from` and `to` to every analytics call, so all calls of one Run read the same window.
- **A Strategic Review is an immutable row of `strategicReviews`**, attached to the Project (`ownerId`, `instanceId`) and not to the Agent: Run, base Review, period, Performance Report (Markdown), Strategic Memory (Markdown), structured references (`familyIds`, `recipeIds`, `publicationIds`), `memoryChanged` and creation date. Each row holds its own whole memory, so a version reads alone. The latest persisted row is the current memory. There is no memory collection, versioning layer, edit, delete or purge.
- **The Agent returns an envelope, Convex validates and writes it** (ADR-052): `report`, `consolidatedMemory`, `references`. The report cannot be empty; the memory can be empty on a first Review. Limits: report 40 000 characters, memory 16 000, 200 references per type; one constant. Over a limit, the Run is `failed` with the reason.
- **References are validated against the Project.** A new reference that does not exist or belongs to another Project rejects the whole result, as `failed`, naming the ids. A reference already in the pinned base's references is accepted even if its entity has since been deleted, so a deletion cannot block a consolidation. An archived entity is a valid reference. Ids are deduplicated.
- **Persistence is atomic, optimistic and idempotent.** In one mutation Convex (1) returns the Review already persisted for this Run, if any, (2) compares the Run's pinned base to the Project's latest Review and rejects the result as a **memory conflict** (Run `failed`, no automatic retry, no merge) if they differ, (3) inserts. Convex has no uniqueness constraint: the check is a read before the insert, an index on `(instanceId, runId)` serving it. A failed or invalid Run changes nothing, and the next Run starts from the latest memory.
- **`memoryChanged` is computed by Convex**, never declared by the Agent: the memory is compared with the base's after normalizing line endings and trimming trailing whitespace; no base counts as an empty text. A Review with nothing new to say returns the previous memory unchanged and is still persisted with its report.
- **One new Internal MCP tool, `get_strategic_memory`** (ADR-080), read-only. For a `strategic_review` Run it serves the base pinned at dispatch; for any other Agent that declares it, the latest persisted Review. It returns whether one exists, its identity, period, memory, references and date, and never the Performance Report. It is the only way the Agent reads the memory; it has no write tool.
- **`list_production_recipes` accepts `from` and `to`** like `get_analytics_summary` and `list_publications` (not with `days`, at most 365 days). `days` behaves as before.
- **Dashboard:** one Project page, Strategic Memory: the current memory as rendered Markdown, then the history, newest first and paginated, each entry showing its period, date, report, its memory, its referenced entities and whether the memory changed. The schedule and `analysisDays` are set on the existing Jobs page. Quantitative figures stay in Analytics.

## Considered options

- **A Mission type run by a Schedule.** Rejected: a Mission is human-triggered work with a review lifecycle and a board card; none of that applies, and `analysisDays` belongs on a Job.
- **A dedicated memory collection, or an Agent-written memory.** Rejected: a second source of truth to keep in step with the Reviews, and versions that would not be tied to the report and period that produced them.
- **Trusting the base Review id returned by the Agent.** Rejected: it could name a Review the Agent never read. Pinning it at dispatch makes the base the input the Agent actually received.
- **Locking or merging concurrent Reviews.** Rejected: a lost Run is cheap, a wrong merge of Markdown is not.
- **Rejecting every reference to a deleted entity.** Rejected: the Agent keeps knowledge the memory already holds, so one deletion would block every later consolidation.

## Consequences

- The Strategy Agent's Hub package declares the `strategic_review` Job type, its instructions and the tools it may call (`get_strategic_memory` and the analytics tools). It must declare no other MCP server (ADR-080).
- The base Review is pinned at dispatch, so a Run that starts before another Review lands is rejected at its end. A conflict costs one Run, and it only occurs when two Runs of one Project overlap.
- Everything the Agent says about performance must follow ADR-084's guarantees (missing is not zero, partial or truncated is not exhaustive, shared or ambiguous measurements are not independent evidence, cumulative is not a period delta). OpenGroow does not check this; the instructions carry it.
- The Strategic Memory records knowledge, not decisions. Later milestones (exploration policy, mission planning, a creative Agent) read it through `get_strategic_memory`.
