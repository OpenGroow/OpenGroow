# ADR-089: No Mission is created from a Source

**Status:** Proposed

## Context

The Source routing Job (ADR-052, ADR-071, ADR-076) picked the day's best Source, asked the Source Agent which Mission type should produce from it and created the Mission, or stored a proposal the user approved with **Produce**. Production now starts from Production Recipes (ADR-083, ADR-088) and from Content Plans (ADR-086); Sources are inspiration for them. Keeping a second way to start a Mission, with its own Job, decision, review mode and per-Source pipeline fields, made Sources look like a production queue.

## Decision

- **No Mission is created from a Source, by anyone.** The `source_routing` Job, its cron and Run kind, `forceProduction` (Produce), `setRouteTarget` (Routed to), `setReviewMode` and the routing decision are removed, with the **Routed to** and **Produce** controls of the Sources pages and the routing option of the Jobs page.
- **Sources keep scoring, listing and deletion.** The Sources page keeps its Scored and Other tabs without any production action; a Source's pipeline is Ingestion, Ready, Scored.
- **What routing wrote on a Source is removed**: `selectedAt`, `producedAt`, `publishedAt`, `productionMissionId`, `routing`, `routeTo`. `produced` and `selected` leave the Internal MCP's Source reads. Missions already created stay as they are.
- **One-shot migration, no compatibility layer**: `dropSourceProduction` clears those fields and `deleteSourceRoutingJobs` deletes the routing Jobs with their Runs; the fields and the retired migrations that read them leave the schema afterwards.
- **A Template that still declares the `source_routing` Job type** gets no Job: the Job sync creates a Job only for a Job type that has a runner, so an installed version of the Source Template that still declares it cannot bring the Job back after `deleteSourceRoutingJobs`. The Source Template drops the declaration and its instructions file.

## Consequences

- A Mission type that needs a Source (`sourceRequired`) can only be planned, not produced from a Source, until a new way to pass a Source to a Mission is designed.
- The Source Agent's job is scoring only.
