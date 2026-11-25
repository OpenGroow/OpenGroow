# ADR-086: Content Planning is a Job that proposes a Content Plan against targets and quantities pinned at dispatch; approved Planned Contents form a read-only Editorial Calendar

**Status:** Proposed

## Context

Milestones 8.1 and 8.2 (ADR-084, ADR-085) measure what works and keep what was learned. Nothing yet decides what to produce next. Milestones 9 (Exploration & Exploitation Policy) and 10 (Content Planning & Editorial Calendar) close that loop with the existing Strategy Agent, without a new Agent, a scoring or recommendation engine, any Mission creation, or any Publication. The human must control volume, destinations and approval. The Agent never writes to OpenGroow (ADR-052, ADR-080). Two Runs, an edited draft and a changing Job configuration can all disagree about what is still to be planned.

## Decision

### Job, configuration and pinned context

- **Content Planning is a Job type `content_planning`** of the Strategy Agent (same shape as ADR-085): its own recurrence and Run Now, Runs that belong to the Job, no Mission. Strategic Review stays independent and Content Planning never writes the Strategic Memory.
- **Configuration** (on `job.config`): `planningDays` (integer 1–60, default 7, independent of the recurrence) and `productionTargets`, each `{ kind, quantity, publishTargets[] }`. `kind` is the `publish.kind` of a Mission type of an active Agent (`video`, `image`, `carousel`, `article`); there is no catalogue of formats owned by OpenGroow, and a Mission type with no `publish` cannot be planned. `publishTargets` are Publish target keys of the Project and must be a set the user chose per `kind`. The sum of `quantity` may not exceed 100. The configuration is validated when saved, with one shared pure validator used by the mutation and the form (as `analysisDays`), and revalidated when a Run starts.
- **Provisioning:** the Job is active by default, weekly on Monday at 06:00 UTC, `planningDays: 7`, no target. Without a usable target the Job ends `skipped` with "no production targets configured".
- **Skips happen before dispatch and create no Run** (Job `lastOutcome` and `lastSummary`, `nextRunAt` advanced, as in the existing Jobs): a draft Content Plan exists (`skipped`, for the scheduled tick and Run Now alike); no usable target left (`skipped`); every target already met (`succeeded`, "targets already met"). A target whose Agent or Publish target has since disappeared is ignored and reported in `lastSummary`; the stored configuration is not modified.
- **OpenGroow pins everything the plan depends on when the Run starts**, on the Run: the Planning period, and per `kind` the target, the existing quantity, the remaining quantity and the Publish targets. The Planning period starts the day after the Run and lasts `planningDays` days inclusive, in UTC (the Job's timezone is UTC and a per-Project timezone does not exist; a Project far from UTC may see a date shift by a day). Dates are `YYYY-MM-DD`. Changing the Job's configuration later never changes a Plan already dispatched. The pins reach the Agent in `run.md` through a new context provider `content-planning-targets`.
- **Remaining quantity is computed by OpenGroow**: `max(0, target − existing)`, where *existing* is the number of Planned Contents `approved` of that `kind` whose date falls in the Planning period, whatever Content Plan they come from. Missions and Publications created outside a plan do not count; they are context for avoiding duplicates only. `proposed` and `rejected` Planned Contents do not count.

### Exploration & Exploitation Policy

It is part of the Strategy Agent's instructions in its Hub package, not a system: no collection, no Recipe score, no ratio. The Agent decides the allocation, states it in the rationale, and must follow ADR-084 and ADR-085's guarantees (missing is not zero, an unused or unmeasured Recipe is not a failing one, small or partial samples are not evidence, no cross-platform global score, already-seen evidence is not independent evidence, content performance is not business success). It must work with no performance data and no Strategic Memory. It selects existing Recipes only and never creates, changes or improves one. It uses research that already exists on Sources and does no discovery of its own.

### Result, validation and persistence

- **The Agent returns an envelope, Convex validates and writes it:** `rationale` (Markdown) and `items`, each `{ missionType, recipeId, sourceId?, title, brief, plannedAt, intent: "explore" | "exploit", rationale }`. It returns no status, no Project, no period and **no Publish targets**: OpenGroow fills `publishTargets` from the pinned configuration of the item's `kind`, so the Agent must pick Recipes compatible with every destination configured for that format.
- **Validation rejects the whole result** (no truncation, no filtering) naming each faulty item: schema; every id belongs to the Project; the Recipe is active and targets that Mission type, whose Agent is active; the `kind` has a pinned target; the quantity per `kind` does not exceed its pinned remainder; a Source is present when the Mission type declares the `observation-production-source` context provider, and belongs to the Project; each pinned Publish target is compatible with the `kind` (`unsupported` rejects, `uncertain` is accepted and shown as such); `plannedAt` falls within the Planning period; size limits.
- **Limits:** rationale 8 000 characters, `brief` 4 000, item rationale 1 000, title 200, at most 100 items.
- **`items: []` is valid:** the Run completes with the rationale in `lastSummary` and creates no Content Plan.
- **Persistence is one atomic mutation**: it returns the plan already persisted for this Run if there is one (a Run already terminal with an empty result is also treated as done), refuses with `draft_exists` if the Project has a draft, then inserts the Content Plan and all its Planned Contents. Convex has no uniqueness constraint, so the guarantees come from doing the existence check and the insert in the same mutation, served by indexes on `(instanceId, runId)` and `(instanceId, status)`. Nothing is created for a failed or invalid Run.
- **Retries:** up to 3 tries with the same pins and the rejection reasons fed back to the Agent (ADR-085's mechanism). `draft_exists` and "no usable target" are not retried.
- **Nothing is created in Missions, Publications, Recipes or Strategic Memory.**

### Data model

- **`contentPlans`**: `ownerId`, `instanceId`, `runId`, `periodStart`, `periodEnd`, `rationale`, `status` (`draft | approved | rejected`), `createdAt`, `approvedAt?`, `rejectedAt?`.
- **`plannedContents`**: `ownerId`, `instanceId`, `planId`, `kind`, `missionType`, `recipeId`, `sourceId?`, `publishTargets[]`, `title`, `brief`, `plannedAt`, `intent`, `rationale`, `status` (`proposed | approved | rejected`), `createdAt`. The `kind` is stored so the format survives the uninstall of an Agent; the Creative Family is derived from the Recipe. A plan does not embed its contents.
- Both belong to the Project, not to the Strategy Agent: they survive the Agent's deletion. As for `strategicReviews`, no purge is added in this milestone (a Project deletion cascade does not exist yet and is a separate debt).
- **The Editorial Calendar is not stored**: a read over `approved` Planned Contents of the Project by date.

### Lifecycle

- **Draft:** the user may edit a title, a brief, the date, the Publish targets (only by removing destinations from the pinned set) and the Recipe (only another Recipe of the same Mission type, so the format and quota never change), and remove a Planned Content (it becomes `rejected`, kept for history, excluded from approval). A new date must lie in the Planning period and not be in the past. No AI revision.
- **Approval is one atomic mutation, for the whole plan:** it refuses a plan with no retained content and a retained content whose date is past (the user removes it or rejects the plan), revalidates references, Recipe availability, compatibility, dates and quotas, then marks the plan and its retained contents `approved`. Quotas use the **targets pinned at dispatch** against the **existing quantity recomputed at approval**; a total below the targets is allowed. It creates no Mission, starts no production, schedules no Publication.
- **Rejection** marks the plan and its `proposed` contents `rejected`; they count toward nothing, and a new Run may then plan.
- **An approved plan and its contents are read-only** in V1. A draft that nobody approves or rejects keeps blocking planning, even when its period has passed: nothing expires it. The Jobs page and the Content Plans page say so.

### Internal MCP and dashboard

- **Extended:** `list_mission_types` returns the `kind`, platforms and whether a Source is required; `list_production_recipes` returns the `kind` and Source requirement (ADR-080 tools, read-only).
- **New, read-only and bounded to the Project:** `list_sources` (status, Replication Score and sub-scores, analysis summary, Creative Family, whether produced; not selected or produced first) and `list_planned_contents` (by date range and status). The Strategy Agent's package declares the tools it may call and no other MCP server.
- **Dashboard (English, ADR-016):** a Project page **Content Plans** (the draft with its rationale, quantities by format, exploration/exploitation distribution and an editable list; Approve and Reject; the history) and a page **Editorial Calendar** (month view with navigation, a list view, details, a link to the originating plan; no creation, editing, drag and drop or production and Publication controls; wording never suggests a scheduled Publication). `content_planning` is configured on the existing Jobs page (`planningDays`, targets per format with destinations, recurrence); Run Now is the existing action.

## Considered options

- **A Mission type run by a Schedule, or a Mission per Planned Content.** Rejected: Missions are human-triggered work with a review lifecycle; creating them is the next milestone, and the plan must exist before anything is produced.
- **A calendar collection copied from approved plans.** Rejected: two sources of truth; one record changing status is enough.
- **Letting the Agent compute quantities, periods or destinations.** Rejected: counts and ownership are deterministic and belong to OpenGroow; the Agent decides only what is creative.
- **Recomputing the remaining quantity at persistence instead of pinning it.** Rejected: the Agent would be validated against numbers it never saw.
- **Filtering or truncating an over-quota result.** Rejected: a silent change to what the Agent proposed; one rejected Run is cheap and retried with feedback.
- **Automatically expiring a stale draft.** Rejected: it changes an editorial state in place of the human.
- **Storing the Agent's `publishTargets` per item.** Rejected: destinations are the user's decision, so the Agent selects compatible Recipes instead.
- **Keying targets by Template and Mission type.** Rejected: too many lines to configure for a distinction the Agent resolves by itself.

## Consequences

- The Strategy Agent's Hub package declares `content_planning`, its instructions and its tools (`get_brand_core`, `get_strategic_memory`, `get_analytics_summary`, `list_production_recipes`, `list_publications`, `list_mission_types`, `list_sources`, `list_planned_contents`); it still declares only the Internal MCP.
- The Planning periods of successive Runs overlap on purpose; a Planned Content counts toward every period containing its date.
- The 100-content ceiling bounds both the configuration and one atomic write.
- A Mission type that declares `observation-production-source` is treated as needing a Source; a Mission type that merely accepts one is not distinguishable today.
- Mission creation from approved Planned Contents, post-approval editing, manual entries, drag and drop, and a per-Project timezone are later milestones; the data model keeps `recipeId`, `sourceId`, `kind` and `publishTargets` so they can start from an approved Planned Content.
