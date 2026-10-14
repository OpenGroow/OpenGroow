# ADR-017: Storing the seo-mcp apiKey in the Agent's config

**Status:** Accepted

### Context

During the **Activation** of an SEO Agent, the user provides a **seo-mcp apiKey**. This key is needed in two places:

1. **On the OpenClaw Instance side** — so that **Runs** can call seo-mcp. It's injected into OpenClaw's MCP config (`Authorization` header) via `RUNTIME_MCP_SERVERS_MERGE`, in memory on the Instance.
2. **On the Convex side (server → server)** — for Activation (`POST /projects`) and **Reconfiguration** (`PATCH /projects/:id`), which are direct Convex → seo-mcp REST calls, bypassing OpenClaw.

The initial design (see the old `SEO_ACTIVATION_FLOW.md`) stated the invariant: *"the apiKey is never persisted in the database; only `seoProjectId` is stored."* This invariant was silently abandoned when Activation moved from an MCP tool call to a `POST /projects` REST call with a GitHub publisher: `activate` now stores the apiKey in `projectAgents.config`. Reconfiguration depends on this (reading the key back to authenticate the `PATCH`, and prefilling it read-only in the edit UI).

Alternatives considered:

- **Restore the invariant**: never store the apiKey. Reconfiguration would then have to either re-request the key on every edit (degraded UX), or route the `PATCH` through OpenClaw (which holds the key) — a heavy Command/Event round trip for a synchronous configuration operation.
- **Store the apiKey in the database** (chosen).

### Decision

The **seo-mcp apiKey is persisted in plaintext in `projectAgents.config`**, by both Activation and Reconfiguration. It's part of the Agent's **frozen config**: immutable after Activation (cf. `GLOSSARY.md`). Reconfiguration reads it back from the existing config and never accepts it from user input.

### Consequences

- A third-party key (seo-mcp) lives in plaintext in the Convex database. A database leak exposes the seo-mcp keys of every Project.
- Reconfiguration remains a simple synchronous operation (Convex → seo-mcp directly), with no detour through OpenClaw and no user re-entry.
- Since the apiKey is immutable, no re-injection of OpenClaw's MCP config is needed during Reconfiguration. **Rotating** an apiKey goes through Deactivation / Reactivation.
- Mitigations to consider if this posture becomes insufficient: application-level encryption of the key at rest, or routing the `PATCH` through OpenClaw to remove the key from the database.
- `buildRuntimeContext` still **never** exposes the apiKey in the Agent's Run context — that invariant still holds.
