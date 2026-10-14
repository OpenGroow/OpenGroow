# ADR-018: Delivering the Brand Core via Run context, not a persistent memory file

**Status:** Accepted

### Context

A **Brand Core** (see `GLOSSARY.md`) is human-curated business knowledge attached to a Project: audience, tone, offer, positioning, editorial rules, constraints, things to avoid. All Agents of a Project need it in order to produce deliverables consistent with the brand.

The source of truth is **Convex** (`brandCores` table, keyed by `instanceId`, structured fields edited via the dashboard). What remains is deciding **how** this content reaches the context readable by the Agent at execution time. The initial request suggested reusing OpenClaw's *memory* (persistent `.md` files like `MEMORY.md`).

Two technical constraints discovered during design:

1. **Each ProjectAgent has its own workspace** (`workspaceKey` unique per agent, created at activation). There is no "global file shared by all agents" at the workspace level.
2. **`context.md` is already regenerated at every Mission dispatch** (`mission_dispatcher_node.ts`), from Convex, and the Agent already reads it (its run file points to it).

### Options considered

- **D1 — Inject the Brand Core into `context.md` at dispatch.** A `# Brand Core` section, rendered from Convex, is prefixed to each Mission's `context.md`.
- **D2 — Persistent `BRAND.md` file in the workspace** (OpenClaw *memory* style), written at activation and referenced by `AGENTS.md`.

### Decision

**D1.** The Brand Core is rendered as markdown from Convex and injected at the top of `context.md` at every dispatch. Nothing is injected if all sections are empty.

**Reasons:**

1. **Freshness for free** — since `context.md` is already rebuilt at each dispatch, a Brand Core edit is automatically taken into account on the next Run. **No propagation mechanism to code.**
2. **No workspace scope problem** — since the workspace is per-agent, D2 would require writing `BRAND.md` into the N active workspaces and resyncing them on every edit. D1 entirely sidesteps this problem: each Mission has its own `context.md`.
3. **Architectural consistency** — the Brand Core becomes a layer of the composed Run context (Project Brand Core + Template's `AGENTS.md` + Agent `config`), exactly like `buildRuntimeContext` does today.

### Consequences

- **No persistent memory nor sync machinery**: we don't import OpenClaw's *memory* (promotion, dreaming, persistent files). If an **emergent memory written by the Agent** becomes necessary someday, that will be a different concept and a different ADR.
- **Intra-Run consistency**: a Run already in progress doesn't see an edit made during its execution — it works on the Brand Core frozen at dispatch. Expected behavior.
- **Injection for all templates**, including utility ones (`hello`). A per-template opt-out (manifest field) could be added later if an agent should not receive brand framing.
- Reverting to a persistent-file model (D2) would be a cross-cutting change (workspaces, propagation, templates' `AGENTS.md`) — hence this ADR.
