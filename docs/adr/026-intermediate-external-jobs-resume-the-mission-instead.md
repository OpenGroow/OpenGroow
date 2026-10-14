# ADR-026: Intermediate External Jobs resume the Mission instead of always producing a terminal RunResult

**Status:** Accepted

*(First ADR written in English — the rest of this file is French; docs/adr is expected to migrate to English over time, this is the starting point.)*

### Context

seo-mcp's `plan_article` tool moved from synchronous to asynchronous: it now returns a `runId` immediately and must be polled via `get_plan_status` until `completed` (a planned `articlePlan`) or `skipped` (blocked, with a reason). The SEO Agent Template needs to consume this.

Megaclaw already has a generic **External Job** mechanism (`externalJobByMissionType` in the Template's `manifest.json`, `decideExternalJobPoll` in `apps/convex/mission_dispatcher/external_job_polling.ts`) used today for `generate_article`/`get_article_status`. But that mechanism assumes an External Job's completion always produces a **terminal** `RunResult` (`success`/`needs_human_review`/`failed`) — the Mission ends up on a stable board state, and any completion the Template maps to `needs_human_review` waits for a **human** to decide what happens next.

`plan_article` doesn't fit that shape. Once the plan is ready (or blocked), there's no human review step: the **Agent itself** judges whether the plan is valid, revises it by calling `plan_article` again with `previousArticlePlan`/`planFeedback` if not, or moves on to `generate_article` if it is. The Mission is still "in progress" from the user's point of view — nothing to review yet.

### Decision

Introduce **Intermediate External Jobs** as a second kind of External Job, alongside the existing (now named) **Terminal External Jobs**:

- A **Terminal External Job**'s completion produces a terminal `RunResult` (`success`/`needs_human_review`/`failed`), a Mission status, and an `Artifact`. This is the existing, default behavior (`generate_article`).
- An **Intermediate External Job**'s completion produces an **Intermediate Result** instead: a non-terminal value written onto the Mission (replacing any previous one) and injected into the `context.md` of a freshly created Run for the *same* Mission, which stays `doing`. No `RunResult`, no `Artifact`, no human review — the Agent picks up where the job left off and decides what to do next, including calling the same tool again for a revision. There is no cap today on how many times the Agent can loop through a revision before it must produce a terminal `RunResult` itself.

This applies to both of `plan_article`'s outcomes (`completed` → planned, `skipped` → blocked): neither is human-facing, so both resume the Mission rather than ending it — unlike `generate_article`, where `skipped` is folded into `failed`.

**Rejected alternatives:**

- **Agent-side polling** (the Agent loops calling `get_plan_status` itself instead of handing off and stopping). Rejected because it contradicts the existing rule that an Agent must not stay alive only to wait for an External Job, and because Megaclaw, not the Agent runtime, already owns all job-polling loops and retry/timeout budgets.
- **Reusing `lastResult`/`Artifact` for the plan payload.** Rejected because `RunResult` is documented as a terminal value and `Artifact` as a user-facing, externally-resolvable pointer; the `articlePlan` is neither terminal nor persisted as a fetchable resource in seo-mcp, and is never shown to the user.
- **Treating `skipped` (blocked) as terminal, like `generate_article` does.** Rejected because there is no human review step in this flow at all — it's the Agent that judges the block and decides (revise, switch keyword, or give up), not a person.

### Consequences

- `externalJobByMissionType` is renamed to **`externalJobsByMissionType`** and becomes, for every Mission type (not just `create_article`), a map keyed by job type (the MCP tool the Agent called) rather than a single scalar contract — `create_article` declares both `plan_article` (intermediate) and `generate_article` (terminal) under its own key. This is a uniform shape across all Templates: no Mission type keeps the old scalar form, even ones with a single job today (`internal_linking`), to avoid a schema that branches on "is this contract scalar or a map."
- Every job entry declares `onComplete: "terminal" | "resume_mission"` explicitly — including existing ones (`generate_article`, `generate_internal_links` get `"terminal"` added) — rather than leaving it an implicit default, so nothing depends on unstated behavior.
- The Agent's non-terminal handoff (`RunResult`'s `in_progress` branch, `apps/convex/run_result.ts`) gains a required `job.jobType` field (the tool name, e.g. `"plan_article"`) to disambiguate which of the Mission type's job contracts applies. Every Template's `AGENTS.md` that already writes this handoff (`seo`, `video`) needs updating to add it — a mechanical, one-line-per-occurrence change enforced by the TypeScript schema change (the field is required, not optional, so any stale handoff fails typecheck).
- `terminalStates.completed` for an intermediate job can list more than one raw status (e.g. `plan_article`'s `["completed", "skipped"]`) when several outcomes are equally "not an error, hand back to the Agent" — this doesn't need to match the bucketing of other jobs (`generate_article` keeps `skipped` under `failed`), since the raw status vocabulary and its meaning are specific to each tool.
- `mission.lastIntermediateResult` is added alongside `mission.lastResult`, replaced (not accumulated) on each resumption. `buildMissionContext` renders it the same way it renders `Last Result` today — a raw JSON dump under its own `## Last Intermediate Result` heading, including the `jobType` so the Agent knows which job it came from — pushed only when the field is set.
- Without a revision cap, a Mission can in principle loop through `plan_article` revisions indefinitely; if this becomes a problem in practice, a cap should first be tried as an `AGENTS.md` instruction (soft, Template-level) before adding a hard Convex-side counter — consistent with the "no per-Mission-type branching in Convex" rule.
