# ADR-025: Logs and Usage — two separate mechanisms, not persisted, without exposing `sessionKey`

**Status:** Accepted

### Context

The old `/projects/[projectId]/logs` page was actually a low-level diagnostic panel (OpenClaw and broker status/logs via SSH commands, "Developer controls") — not a business view. We want to replace it with a real Usage page, and move per-Agent logs to the relevant Agent's Workspace page ("See logs" button).

Two data sources exist on the OpenClaw side, with different granularities:

- `openclaw status --usage` does **not** expose consumed tokens or a dollar cost: it's a snapshot of **per-provider rate-limit quota** (`windows: [{ label, usedPercent, resetAt }]`, plus `plan`/`summary`/`error`) — cf. `ProviderUsageSnapshot` in the OpenClaw CLI. It's aggregated at the whole-instance level, across all providers — no CLI flag lets you scope it to a session or an agent, and no CLI flag exposes tokens/cost per provider.
- The per-execution-turn detail (usage, cost, agent actions) only exists in the **session JSONL files** that OpenClaw itself writes into the Instance's Workspace — nothing is currently persisted on the Convex side (neither execution stdout nor the transcript).

Additionally, `sessionKey` is an infrastructure term explicitly banned from the UI (cf. "What the user never sees"). Yet per-Agent logs technically correspond to a succession of OpenClaw sessions.

### Options considered

- **A single source** for both Logs and Usage (parse the session JSONL for both): rejected, because `openclaw status --usage` doesn't provide the same granularity as the JSONL, and the CLI is the documented/official source for usage.
- **Expose sessions directly** in the UI (list of `sessionKey`): rejected, contradicts the GLOSSARY.md rule forbidding `sessionKey` in the UI.
- **Persist** logs and/or usage in Convex to enable history: set aside for this iteration, in favor of on-demand loading (consistent with the current behavior of the logs panel).

### Decision

**Logs and Usage are two independent mechanisms, both queried on demand (no new Convex table):**

1. **Usage**: new Convex action that runs `openclaw status --usage` on the Instance and returns, per provider, its rate-limit quota windows (no tokens/cost — cf. Context). Displayed on `/projects/[projectId]/usage` — the old `/projects/[projectId]/logs` route is renamed accordingly, since it no longer contains logs. The SSH panel that used to live there is renamed "Developer" and keeps its two current entry points (global route `/logs` → `/developer`, and per-project route `/projects/[projectId]/logs` → `/projects/[projectId]/developer`) — a simple rename, without consolidating the two routes for this iteration. (The `/instances/[instanceId]/*` route tree, orphaned since the instances→projects migration — PR #81 — isn't referenced by any active link and remains out of scope for this decision.)
2. **Logs**: new Convex action that reads the session JSONL files in the Instance's Workspace. Accessible from an Agent's Workspace detail page (`/projects/[projectId]/workspaces/[workspaceKey]/logs`), via a "See logs" button. The UI **groups entries by Mission then by Run** (never by "session") and filters on the Missions of the Agent that owns the Workspace — `sessionKey` remains an implementation detail that never surfaces on screen.

### Consequences

- No per-Agent Usage view for now: this is an OpenClaw CLI limitation, not a product choice. If OpenClaw ever exposes per-session scoping, this ADR will need to be revisited.
- The Workspace page remains the technical per-Agent entry point; the conceptual duplication between "Workspace" and "Agent" (already noted) isn't resolved by this ADR and remains a separate consolidation effort.
- No log or usage data is historized in Convex: a consumption trend over time would require a new decision (persistence).
- **No tokens/cost displayed**: the page shows rate-limit quotas (% of a window used per provider), not token consumption or a dollar amount — the OpenClaw CLI doesn't expose that data. If a real need for cost tracking arises, it will require a new source (e.g. parsing the session JSONL files) and a new decision.
