# ADR-069: A generic Publisher owns publication; Agent Templates return a Publishable in a unified format

**Status:** Accepted

## Context

Postiz publishing config (channels, boards, credentials) is duplicated in every MCP (`demo-video-mcp`, `seo-mcp`, the visual-social tools), and each MCP calls Postiz itself. Adding a service, or a new kind of deliverable, means touching every MCP. ADR-034 moved that configuration into each MCP's own dashboard, which made the duplication permanent.

## Decision

- **A Publisher is a Project-level integration** (one adapter plus its per-Project config), with its own dashboard page. V1 has a single adapter, Postiz. The concept is generic so a second service is a new adapter, not a new architecture.
- **Agents never publish.** An Agent Template returns a **Publishable** in the RunResult's Artifact (`publishable` field). OpenGroow publishes on the human `publish` action of the review, or automatically with `autoPublish`.
- **The unified format is a closed set of kinds owned by OpenGroow**: `video`, `image`, `carousel` in V1, each with a fixed schema, plus a free `metadata` the adapter reads if it understands it. Adding a kind is a product change, not a Template declaration. This differs from ADR-051 on purpose: a Source is only described, a Publishable is interpreted by an adapter, so there must be no guessing.
- **References only** (media URLs, ids at the producing service), never content (ADR-010 unchanged).
- **The Template manifest declares**, per Mission type, the kind it produces and the Publish targets it may use. Convex validates the Publishable against the kind and returns errors to the Agent (same approach as ADR-051's `analysisSchema`).
- **Publish targets are logical** (`instagram`, `pinterest:recipes`). A Mission or Schedule payload carries a target and an optional `publishAt`; the human can change both at review. The Publisher maps targets to the service's channels (Postiz channels are discovered through its API and picked from a menu) and holds the service-specific settings per target. None of that reaches the unified format.
- **A Publication** tracks each (Mission, target): `pending`, `scheduled`, `published`, `failed`, with external URL, scheduled date and error. A Mission is `done` when all its Publications are `published`; a failed one is retried alone. Status is followed by Convex polling, as for External Jobs.
- **No activation gate** (unlike ADR-034). An unmapped target disables `publish`, or makes the Publication `failed` with an explicit message under `autoPublish`; it is retried after the Publisher is fixed.
- **Migration is by opt-in, template by template.** A Mission type that declares `publish` in its manifest no longer publishes itself: its instructions stop calling the MCP's publishing tools and the MCP stops receiving publishing settings. No dual-write. Templates not migrated behave as today.

## Consequences

- Amends ADR-034: the "Postiz channels" configuration leaves the MCP dashboards and moves to the Publisher. The rest of ADR-034 (`apiKey`, `statusCheck`) is unchanged.
- Amends ADR-024: Pinterest board routing becomes a Publish target in the Schedule payload instead of a `pinterestBoardId` passed to the MCP.
- ADR-010 is confirmed. `article` publishing (GitHub, from `seo`) stays in `seo-mcp` and is out of V1.
- The review's `publish` action gets a real executor in OpenGroow instead of depending on the MCP.
- New Convex state: Publisher config per Project and Publications, plus the Artifact `publishable` field in the RunResult contract.
