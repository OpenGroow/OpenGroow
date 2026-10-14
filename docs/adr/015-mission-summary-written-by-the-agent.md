# ADR-015: Mission `summary` written by the Agent through a dedicated write channel (summary-only)

**Status:** Accepted

### Context

The Missions Kanban displays, on each card, a label that differentiates missions of the same type. The input `payload` is not enough: it can be **empty** (Schedule case, without a keyword), and having the dashboard parse the `payload` per type would create tight coupling. We want a free-text, type-agnostic **`summary`**, **produced by the Agent** and displayed **verbatim**.

Key constraint: this `summary` must be visible **during the `doing` status** ("In progress"), not only upon completion.

But today the Agent **pushes nothing**: it produces a RunResult (file `missions/<missionId>/outputs/<runId>.json`) that Convex **reads at the end of a Run** and translates into a status. This is the "agent reports, Convex writes" model. Passing the `summary` through this channel would only make it available at `to_validate`/`done` — too late for `doing` cards.

### Options considered

- **RunResult only** (status quo): `summary` read at completion ⇒ `In progress` cards stay blind. No new channel, but the "in-progress summary" goal is abandoned.
- **Early event**: the Agent writes a file early, the runtime emits a `MissionSummarized` Event that Convex applies. No new REST surface, but extra runtime plumbing.
- **Agent-side write tool**: the Agent calls, early in its Run, a dedicated tool that writes the `summary` directly.

### Decision

The Agent writes the `summary` via a **dedicated tool** (**HMAC REST** endpoint → Convex, consistent with the ADR-013 boundary: the agent can also talk to Megaclaw server-side via an authenticated channel). This channel:

- writes **only** the **Mission**'s `summary` field;
- **never touches `status`** — the status remains **derived from the Run's/RunResult's lifecycle** (`runs.markCompleted`).

The `summary` format is a **strict contract** that **every Agent Template must honor**: a **short, bounded line of text**, emitted early in execution.

### Reasons

1. **Early availability** — the `summary` appears as soon as `doing`, in real time via Convex subscriptions.
2. **Preserving invariants** — restricting the write to `summary` protects two invariants: "status is derived from RunResult" and the aggregate rule "never modify a Mission/Run outside its root." An Agent that pushed an arbitrary status could declare itself `done` without a validated deliverable and break the Kanban.

### Consequences

- **New Agent → Convex write surface** (tool + HMAC REST endpoint): partially breaks the "agent reports, Convex writes" purity — accepted, but strictly bounded to `summary`.
- **Cross-cutting contract**: every Agent Template (`packages/agent-templates`) must emit the `summary` line; it is documented in each template's `AGENTS.md`. A decision that is **hard to walk back** once the contract is spread across templates.
- If a future need for broader Agent writes appears (e.g. Agent-driven status), it will need **a new ADR** — not covered here.
