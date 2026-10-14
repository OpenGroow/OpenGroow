# Marketing engine: Sources, scoring, Creative Families

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Source

A **Source** is one dated, machine-written record of something an Agent saw in the outside world — a social post, a search keyword, a product signal — in a form common to every kind of origin, so a single **Sources** page can list and compare records from different Agents (e.g. `social-engagement` and SEO). It replaced the social-specific Observation (ADR-051): the model is domain-agnostic, social media is only the first origin.

- **Source declaration**: for each kind of Source it can produce, an Agent Template declares — entirely in its manifest (`sources[]`, mirroring `missionTypes[]`), never in dashboard or Convex code — a **type** (unique in the Template), a `label`, a free-text `family`, an `agentsMd` instruction file (unique across the Template's Mission types and Sources) and an `analysisSchema` (JSON Schema, restricted to an allow-list of keywords the validator and the dashboard both support); asynchronous enrichment is declared beside it in `externalJobsBySource`. Every Source record carries the type of the declaration that produced it (`sourceId` on the record); a record whose type the Template did not declare is rejected. Label and family come from the declaration, never from the Agent, so they stay consistent across records. _Avoid_: "Source Capability" — a separate term was considered and dropped, the declaration is enough.
- **Three layers** on every Source: common metadata (origin, dates, processing status), a common **marketing representation** (what it teaches: topics, audiences, problem, intent, reproducible elements…), and a **Source Analysis** block specific to its origin (an Instagram Reel's hook and pacing, a keyword's search volume). Content-craft fields (hook, pacing, CTA…) belong to Source Analysis, never to the common layer — they describe a piece of content, not every origin.
- **Normalized by a Source ingestion Job, against a schema OpenGroow owns**: the common schema is defined once by OpenGroow and validated on every write, with errors handed back to the writing Agent so it can correct itself. An optional `raw` (verbatim capture, 64 KB cap) may accompany it, and `runId`/`sourceJobId` provenance is set by OpenGroow from the Source ingestion Job execution in flight, never by the Agent. `sourceJobId` points to the generic `jobs` row whose type is `source_ingestion`. Scoring is the opposite: never written by an Agent, always computed by OpenGroow with the same rules for every origin, so a score means the same thing whichever Agent produced the Source.
- **Append-only**: a Source is always a new dated record — the same Reel seen twice, or a keyword collected weekly, yields several Sources. No deduplication yet; a natural key linking a series may come later.
- **Enrichment is optional** and belongs to the origin: only some (e.g. a Reel needing transcript and frames) have one. A Source without enrichment is `ready` as soon as it is written, provided its marketing representation is usable (see **Source Agent**) — a Source with an empty/unusable marketing representation is not eligible for scoring even once `ready`.
- **Pipeline status is derived, not stored**: no single field names "where a Source is." The dashboard computes a stepper (Ingestion → Ready → Scored → Routed → In production → Produced → Published, with Failed/Unavailable/Excluded as terminal states) from `status`, `scoring`, `selectedAt`, `productionMissionId`, `producedAt`, and `publishedAt` — all of which already exist and would otherwise desync from a stored summary field.
- **Selection lifecycle** (ADR-051): once scored (see **Source Agent**), a Source becomes eligible for the Replication Score ranking. `selectedAt` is set when it is picked as an Instance's winner and the Source routing Job begins handling it; this permanently removes it from future rankings. `producedAt`/`publishedAt` record, best-effort, that content was actually produced/published from it.
- **Production (ADR-052, ADR-051)**: the Source routing Job invokes the **Source Agent** for the selected Source. The Agent chooses a type-specific production Mission from the active Templates, and OpenGroow's dispatcher creates that user-facing Mission. `productionMissionId` points directly to the production Mission under human review. Job executions and their logs are not Missions and do not appear in the Mission Kanban.

### Source Agent

The `source` Agent Template (ADR-052): a system-like Agent Template, activated the same way as any other, whose two Mission types — `score` and `routing` — are common to **every** Source regardless of which Template produced it. It replaces the earlier arrangement where `score_observation`/`plan_observation_production` were declared on, and always dispatched to, the `social-engagement` Template specifically.

- **`score`**: judges a single Source against three fixed, origin-agnostic questions — how relevant it is to the Project's product/audience (`productFit`), how strong its underlying idea/angle is (`creativeStrength`), and how exploitable it is with the Instance's own production capabilities (`replicability`). All three are always required — never left blank for lack of data. The judgment reads the Source's common **marketing representation** + the Brand Core, and the origin-specific **Source Analysis** when present, but never *requires* it: `productFit` in particular must never need `Source Analysis` to make sense, because a well-formed marketing representation already carries whatever an enrichment step found worth surfacing. Dispatched by a new periodic per-Instance job (Jobs page, pause/Run Now like a SourceJob): one `score` Mission per `ready`, unscored Source found on each pass.
- **`routing`**: the daily Top-1 winner's routing step (see Source's selection lifecycle) — picks which active Template's Mission type should produce from this Source by reading each candidate Mission type's `description` (a new, free-text `MissionType` manifest field, capped at 500 characters by manifest validation — as is the Template-level `description` a Mission type without its own falls back to — and presented to `routing` strictly as quoted, untrusted data, never as instructions; read only by `routing` — the same "let the caller read a description and judge fit" shape as a tool/skill description), rather than a fixed per-`mediaType` branch. Still dispatched from the existing daily ranking/selection job (`observations_scoring_daily.ts`, unchanged Convex-only ranking mechanics — no Agent involved in the ranking math itself), which now also appears on the Jobs page per Instance (pause/Run Now) instead of running as an invisible system cron.
- _Avoid_: confusing the daily ranking/selection job with a Mission or an Agent — it is plain Convex code that computes the Replication Score and elects the day's winner, then dispatches the `routing` Mission to the Source Agent for that one Source.

See ADR-052.

### SourceJob

The unit of work that fills the database with a **Source**: fetch the content (an Agent's raw session report, an MCP such as a keyword provider), normalize it into the common schema, and write it — one and the same behavior whatever the origin (`engage`, SEO…). It executes an Agent, but it is **not a Mission**: a Mission is work a **human** triggers and that may be reviewed; a SourceJob ingests data and involves neither. Trackable and retryable from a dedicated Jobs page.

- **One Agent instruction file (`agentsMd`) per Source type, two phases.** _Ingest_ (fetch, normalize, write the Source as `processing`), then, only for origins that need it, _enrichment_: the job hands off a long-running external job (e.g. a Reel's transcript and frames) and stops; OpenGroow polls it, and on completion **resumes the same SourceJob** with a new Run that receives the result, normalizes it and completes the Source. There is no separate "enrich" entity.
- **One SourceJob per Agent, batched**: a run of the job covers every Source its Agent declares and everything not yet handled, in a single Agent session — each SourceJob costs a session. Each Source keeps its own processing status inside the batch, and retry is per Source. What was handled is tracked on the job side, never on the Agent's Runs, so a Run that has nothing to do with Sources (e.g. writing an article) is never touched.
- **Scheduled, never triggered by a Mission's end**: a SourceJob runs on a recurrence the user sets per Agent from the Jobs page — a mechanism separate from a **Schedule**, which only ever creates Missions — or when a long-running external job finishes (resumption). A Mission knows nothing about Sources: an Agent whose Missions leave raw material behind (e.g. `engage`'s session report) describes in the Source's own instructions where to find it, and OpenGroow hands the job the Agent's Runs since the previous job so it can read what it needs. What to poll for a polled origin (e.g. seed keywords) comes from the Agent's own configuration.
- _Avoid_: confusing with **External Job**, which is launched by an **Agent** during a Mission's Run. Both may poll an external MCP and resume work; what differs is who owns them and what triggers them, not where the work executes (hence not "internal job").

### Observation

Retired term: the social-specific record of a post an Agent liked or commented on during an `engage` Run. It was replaced by the **Source** (ADR-051), which any origin can produce; the `observations` table (its rows purged by migration, its declaration kept only until that has run everywhere), its harvest at Run end, its `enrich_observations` Mission (deleted by migration) and its Observations pages no longer exist. Say **Source**, and **SourceJob** for the work that fills it. The scoring, selection and production behavior once documented here now belongs to the Source (see **Source**, **Replication Score** and **Creative Family**).

- _Avoid_: using it for new work; and calling a Source an Insight, a Learning, or a Metric — a Source is unprocessed evidence, not a conclusion drawn from it.

See ADR-051.

### Creative Family

A named creative pattern or mechanic an Instance's Sources get grouped into (e.g. "fake_sms", "mini_story", "letter_reveal") — used to later tell which formats actually work for that Instance's own audience.

- **Discovered per Instance, not predefined globally**: deep enrichment shows the LLM the Instance's own Creative Families so far and asks it to either assign the Source to one of them or propose a new one. There is no shared, cross-Instance taxonomy — unlike `mediaType` (a small, closed, global enum), what counts as a "format" is expected to differ entirely between Instances/brands.
- **Descriptive only in V1**: stored on every Source (`creativeFamilyId`), but does not feed into the Replication Score. It becomes actionable only once enough Missions have been produced from enough Sources to compare each family's real-world performance — a deliberately deferred step.
- _Avoid_: fixing an enum of families ahead of time, or letting the LLM invent free-text family names per Source — both were considered and rejected in favor of a stable, per-Instance, reused-or-created list.

See ADR-051.

### Replication Score

A composite 0–1 score on a scored Source, expressing how good an inspiration it is to replicate for *this Instance's own product* — not how viral or popular the underlying Source is.

- **Weighted sum of four sub-scores**: Engagement Score (40%, see below) plus three fixed-rubric LLM judgments scored in increments of `.25`, computed by the **Source Agent**'s `score` Mission (ADR-052) against origin-agnostic questions — Product Fit (25%, how relevant the Source is to the Instance's product/audience, judged against the Brand Core), Replicability (20%, how exploitable it is with the Instance's own production capabilities), and Creative Strength (15%, how strong the Source's underlying idea/angle is). These three are judged from the Source's marketing representation (+ Source Analysis when present) and computed once, right after scoring, never recomputed.
- **Optimizes for fit, not virality**: a highly-viral Source with poor Product Fit and Replicability scores lower than a moderately-viral one that fits well — deliberately, since the score ranks inspiration value for this Instance, not raw popularity.
- **Recomputed daily, only within the eligible pool**: for each Instance, every scored, non-excluded, not-yet-selected Source from the last 7 days. The weights, the 7-day window, and the minimum-score gate below are fixed constants shared by every Instance in this first version, not per-Instance configuration.
- **Gated, not always-decisive**: an Instance's daily top-scoring eligible Source only gets selected (see Source's selection lifecycle) if its Replication Score clears a fixed minimum. Below it, the Instance simply produces nothing that day rather than being forced to pick a mediocre "best of a bad batch."
- _Avoid_: confusing with the old Insight score (a raw engagement-count sum with no product/creative judgment) — the Replication Score is Source-level, not a separate entity's field, and folds in judgment the raw count never captured.

See ADR-051.

### Engagement Score

The Replication Score's performance sub-score: a 0–1 measure of how well a Source's post performed, normalized *within that day's batch of Sources for the Instance*, not on any absolute scale.

- **Two separate percentile rankings, never mixed**: Sources with a known view count are ranked by a weighted engagement rate (`likeRate`/`commentRate`/`shareRate`/`saveRate`, weighted toward shares/saves); Sources without one are ranked by a log-scaled raw engagement count instead. A rate and a raw count live on different scales, so each group is percentile-ranked only against itself.
- **Neutral when the comparison group is too small**: a group with fewer than 5 Sources produces a flat `0.5` rather than a percentile — a percentile computed from a handful of posts is noise, not signal (a lone Source in a group would otherwise land at a meaningless `1.0`).
- _Avoid_: treating this as a creator-relative measure — comparing a post to its own creator's typical performance, rather than to the day's unrelated batch, is a known and deliberately deferred improvement (no per-creator history exists yet).

See ADR-051.
