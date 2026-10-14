# ADR-056: The official Template scope is `@opengroow`; `@megaclaw` ids are migrated and read through an alias

*Follow-up to ADR-054 and the scope reservation of #666. ADR-054 and earlier text that mention `@megaclaw/*` stay as written.*

### Context

The official public repository now lives in the `OpenGroow` GitHub organization (`OpenGroow/groowhub`). Official Templates must carry ids under the scope that names their publisher, before they are extracted and published (#672). Template ids only: npm workspace names and `MEGACLAW_*` variables are unrelated.

### Decision

- `@opengroow` is the reserved official scope, declared once (`OFFICIAL_SCOPE` in `packages/agent-templates/src/official-scope.ts`) and used by the hub index parser and the scope reservation. `@megaclaw/*` is deprecated: refused by the hub index and by every install path.
- A migration rewrites every stored `templateId` (Agents, Missions, Schedules, Jobs, Sources, Runs, MCP URL overrides, registry rows and their `manifest.id`).
- Installed snapshots are **not** rewritten: their files keep matching their digest and the legacy reader aliases the `package.json` name from `@megaclaw/*` to `@opengroow/*` in memory (`storedClawPackageToTemplate`). Missions pinned to a snapshot keep resolving it.
- `openclawAgentName` and `runs.agentName` are not rewritten (an unset `openclawAgentName` is pinned to the slug of the old id): they name the agent registered in the gateway, which only knows `opengroow--*` after the Agent is refreshed.
- `MEGACLAW_HUB_REPOSITORY` defaults to `OpenGroow/groowhub`.

### Consequences

- The Social Engagement plugin accepts the three agent ids it can be registered under (`social-engagement`, `megaclaw--social-engagement`, `opengroow--social-engagement`).
- The old scope survives only in the migration, the alias and their tests.
