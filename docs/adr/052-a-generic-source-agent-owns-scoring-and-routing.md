# ADR-052: A generic `source` Agent owns scoring and routing; SourceJobs ingest from Run result files

**Status:** Accepted

### Context

ADR-051 left scoring and production planning dormant on purpose: `score_observation` and `plan_observation_production` are still declared as `social-engagement` Mission types, and every dispatch path (`observations_scoring.dispatchScoringMission`, `observations_selection.selectWinner`/`forceProduction`) hardcodes `SOCIAL_ENGAGEMENT_TEMPLATE_ID` — regardless of which Template actually produced the Source being scored or routed. Nothing on the SourceJob path triggers `score_observation` at all, so no Source is ever scored or selected. Meanwhile `observations_scoring_daily.ts`'s ranking/selection walk is already generic over `sources` (any `templateId`), and the product now needs both Missions to genuinely work for any origin (social, SEO, and beyond) — not just to be theoretically origin-agnostic while implemented against one Agent.

Two further gaps surfaced while designing this: (1) a Source's progress through scoring/selection/production has no single visible status anywhere in the dashboard — only `source.status` (the ingestion/enrichment status) is shown; (2) the daily ranking/selection job itself runs as an invisible system cron, so a Source stuck after scoring gives no visible signal of when, or whether, it will be picked up.

### Options considered

- **Pure Megaclaw computation, no LLM at all** (the literal reading of ADR-051's "Megaclaw computes it, with the same rules for every origin") — rejected: `productFit` and `creativeStrength` require reading and weighing free-text, qualitative content (the marketing representation, the Brand Core) — there is no formula for "does this angle fit this brand." Only the Engagement Score sub-score is a genuine pure calculation, and it already is one. "Computed by Megaclaw" is satisfied instead by making the *rubric itself* uniform and Megaclaw-orchestrated (one Mission definition, one dispatch path, no per-origin customization), not by removing the LLM.
- **Each Source-producing Template declares its own `score_observation`/`plan_observation_production`** (mirroring how `sources[]` is declared per Template) — rejected: the whole point is that scoring and routing must mean the same thing regardless of origin; letting each Template author its own rubric or routing logic reopens exactly the inconsistency Source itself was created to close.
- **A rigid declarative routing table** (each Source type or `mediaType` maps to one fixed producing Mission type, as `plan_observation_production.md` does today for `carousel`/`video`/`image`) — rejected: it hardcodes the closed list of producible formats into one instruction file, coupling it to every current and future producing Template. A `description` field the router reads and judges against, the same shape as a tool/skill description an Agent already knows how to weigh, scales to new producing Templates without touching the router's own instructions.
- **An explicit stored `pipelineStage` field on Source** — rejected: every fact it would summarize is already stored (`status`, `scoring`, `selectedAt`, `delegateMissionId`, `producedAt`, `publishedAt`); a derived value can never drift from them, where a second stored field could be left stale by a write that forgets to update it.

### Decision

**A new Agent Template, `source`**, activated like any other Template (no special provisioning path). It carries two Mission types, renamed to state what they now are:

- **`score`** (was `score_observation`): judges exactly one Source per Run against three fixed, origin-agnostic questions — `productFit` (relevance to the Project's product/audience), `creativeStrength` (strength of the Source's underlying idea/angle), `replicability` (how exploitable it is with the Instance's own production capabilities). All three are always required — never partially skipped for lack of data. The judgment reads the Source's marketing representation + Brand Core, and the origin-specific Source Analysis when present; `productFit` in particular must never *need* Source Analysis, so any content-craft detail worth weighing for fit is expected to already have been surfaced into the marketing representation by the origin's own enrichment step, not read directly by `score`. A Source needs a usable marketing representation before it is eligible — an empty/unusable one leaves it out of scoring even once `ready`.
- **`routing`** (was `plan_observation_production`): unchanged responsibility (plan, then delegate — never call a producing MCP itself), but its target is no longer a fixed `carousel`→`create_carousel`/`video`→`create_reel` branch. Every active Template's Mission types may declare a new, free-text `description` field (`MissionType.description`, manifest-level); `routing` is handed the descriptions of every candidate Mission type on the Instance's active Agents and picks by judgment, the same way an Agent already picks among tool/skill descriptions.

**Dispatch changes from a hardcoded Template id to two periodic per-Instance jobs, both visible on the Jobs page (pause/Run Now) instead of one dormant path and one invisible cron:**

- A new periodic job scans, per Instance, every `ready` Source without a score and dispatches one `score` Mission each pass — one Mission per Source, never a batch inside one Run (preserves the existing "one Mission = one judgment" contract).
- The existing daily ranking/selection job (`observations_scoring_daily.ts`) keeps its Convex-only ranking math unchanged (no Agent involved in computing the Replication Score itself) but now also appears on the Jobs page per Instance, and dispatches its winner's `routing` Mission to the `source` Agent instead of `social-engagement`.

**A Source's status becomes visible as a derived pipeline stepper** (Ingestion → Ready → Scored → Routed → In production → Produced → Published, with Failed/Unavailable/Excluded as terminal states elsewhere on the same line), computed from the fields that already exist — no new stored field. The six numeric scoring fields (`productFit`/`replicability`/`creativeStrength`/`rawEngagementScore`/`engagementScore`/`replicationScore`) stay visible too, collapsed under a "scoring details" section rather than surfaced individually on the stepper — they are two different computations (an LLM judgment vs. a daily percentile ranking) that both just happen to land in the same "Scored" stage.

### Consequences

- `score_observation.md`/`plan_observation_production.md` and their manifest entries move off `social-engagement` onto the new `source` Template, under their new names; the handful of Missions of the old types (dormant — none have ever produced a real Run per ADR-051) do not need a data migration, only the manifest/instruction-file move.
- The "usable marketing representation" gate is a new precondition on Source eligibility that existing origins' `agentsMd` instructions do not yet explicitly write for — each origin's own Source instructions may need a pass to guarantee theirs is exploitable, not merely non-empty.
- `sources_social.ts`'s accessors (`engagementCountsOf`, `platformOf`, social-specific `analysis` field names) remain social-specific for the Engagement Score sub-score — this ADR does not generalize engagement/performance signals themselves, only the LLM rubric and the routing step. A non-social origin without engagement counts still ranks (Engagement Score's existing small-group fallback, `GLOSSARY.md`), it just never has a real engagement signal to contribute.
- A new `MissionType.description` manifest field is additive and optional — Mission types that are never routing targets (e.g. `engage`, `score` itself) simply never declare one.
- Scoring and routing now require the `source` Agent to be active on the Instance. An Instance that produces Sources but has not activated it gets a dispatch failure, the same way the carousel path already behaves with no active `carousel-mcp` Agent. Auto-activating it with the first Source-producing Agent is deliberately left out of this step.
- The Mission payload keeps its `observationId` key (and `routing` still reads a context section named `# Observation Production Source`); renaming those to Source vocabulary is a separate, larger rename that ADR-051's lift-out already owns.
- `social-engagement` is back to a single Mission type, `engage`. The Mission-type guards that exist because it once had several (`buildRuntimeContext`'s skip, `runs.ts`'s `SHARED_PAIRED_NODE_MISSION_TYPES`) are kept: they are about "any non-`engage` type", not about the two that left.
- The Template id `source` sits next to the domain term **Source** (the record). They are distinct: the Agent is named for what it operates on.
### SourceJob ingestion: the Run result file is the write boundary

This part of the decision supersedes, for the SourceJob flow, the signed-route decision of #529 (ADR-051): "the Agent writes each Source through a signed `POST /api/sources`". ADR-051 itself is historical and is not amended.

### Context

The signed Source write route assumed the Agent could call Convex. It cannot: it has no signing key in its environment, no tool and no instruction for the call, and everywhere else in Megaclaw the Agent only reports (a file, an MCP call) while Convex reads or polls. In practice no Source was ever written.

### Decision

- **The Agent reports, Convex writes.** The Agent puts the Sources it normalized in its own result file (`SourceRunResult`: `success` with `sources`, `failed`, or an enrichment handoff). Convex reads that file through the already-signed runtime channel and validates and inserts each Source internally, with no HTTP.
- **Same guarantees as the retired route:** the Source id and Template are the Run's own Agent's; label and family come from the declaration; status is `processing` when an enrichment is declared, else `ready`; owner, instance and provenance (`runId`, `sourceJobId`) come from the Run, never from the payload; unknown, scoring and status fields are rejected; the `raw` capture is capped at 64 KB; an entry with an `id` completes an existing `processing` Source. A cancelled Run inserts nothing; a result carries at most 50 Sources and the surplus is left to the next execution (the cursor does not advance).
- **Job file layout mirrors Missions:** one run file `jobs/<job>/run.md` (instructions, batch, schemas, valid result shapes) and the result under `jobs/<job>/outputs/`. The files are deleted when the job settles.
- **Partial acceptance and retry with feedback.** Valid Sources are kept; invalid ones are reported with their position and origin, as a complete list. Convex starts a resumed execution (same mechanism as the enrichment resume) whose run file carries the errors, and the Agent resends only the failed entries (no duplicate). Bounded to 3 tries, then the job ends `Failed` with the errors.
- **The HMAC Source route, its handler module and its tests are removed.** Two validation paths would drift. Their useful assertions live in the SourceJob ingestion tests. The agent HMAC helper stays: the Mission summary route uses it.

### Consequences

- **Accepted trade-off:** the Agent no longer sees validation errors inside the same session (the route returned them immediately). It sees them in the immediately resumed execution, a fresh session that receives the errors and the entries to resend. This departs from the original wording of #529.
- One validation and insertion path; no dead endpoint; nothing to distribute to the Agent to make ingestion work.
- A result file has no explicit size cap along the path; the effective limit is that of a stored Convex document (about 1 MB).
