# Marketing engine: Sources, scoring, Creative Families

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Source

A **Source** is one dated, machine-written record of something an Agent saw in the outside world — a social post, a search keyword, a product signal — in a form common to every kind of origin, so a single **Sources** page can list and compare records from different Agents (e.g. `social-engagement` and SEO). It replaced the social-specific Observation (ADR-051): the model is domain-agnostic, social media is only the first origin.

- **Source declaration**: for each kind of Source it can produce, an Agent Template declares — entirely in its manifest (`sources[]`, mirroring `missionTypes[]`), never in dashboard or Convex code — a **type** (unique in the Template), a `label`, a free-text `family`, an `agentsMd` instruction file (unique across the Template's Mission types and Sources) and an `analysisSchema` (JSON Schema, restricted to an allow-list of keywords the validator and the dashboard both support); an optional **Platform** (below); asynchronous enrichment is declared beside it in `externalJobsBySource`. Every Source record carries the type of the declaration that produced it (`sourceId` on the record); a record whose type the Template did not declare is rejected. Label and family come from the declaration, never from the Agent, so they stay consistent across records. _Avoid_: "Source Capability" — a separate term was considered and dropped, the declaration is enough.
- **Platform** (ADR-077): where a Source comes from (Instagram, TikTok…), declared by its Template on the Source declaration: a name, a logo, the domains of its pages, how a post is recognised so it is ingested once, and how its thumbnail is found. Generic code never names a platform; a Source whose Template declares none has no logo, no thumbnail and is matched by its page.
- **Three layers** on every Source: common metadata (origin, dates, processing status), a common **marketing representation** (what it teaches: topics, audiences, problem, intent, reproducible elements…), and a **Source Analysis** block specific to its origin (an Instagram Reel's hook and pacing, a keyword's search volume). Content-craft fields (hook, pacing, CTA…) belong to Source Analysis, never to the common layer — they describe a piece of content, not every origin.
- **Normalized by a Source ingestion Job, against a schema OpenGroow owns**: the common schema is defined once by OpenGroow and validated on every write, with errors handed back to the writing Agent so it can correct itself. An optional `raw` (verbatim capture, 64 KB cap) may accompany it, and `runId`/`sourceJobId` provenance is set by OpenGroow from the Source ingestion Job execution in flight, never by the Agent. `sourceJobId` points to the generic `jobs` row whose type is `source_ingestion`. Scoring is the opposite: never written by an Agent, always computed by OpenGroow with the same rules for every origin, so a score means the same thing whichever Agent produced the Source.
- **Append-only**: a Source is always a new dated record — the same Reel seen twice, or a keyword collected weekly, yields several Sources. The one exception is a re-read: an entry with the same origin and capture time as an existing Source of the Agent (a batch read again after a failed execution) is not written twice. A natural key linking a series may come later.
- **Enrichment is optional** and belongs to the origin: only some (e.g. a Reel needing transcript and frames) have one. A Source without enrichment is `ready` as soon as it is written, provided its marketing representation is usable (see **Source Agent**) — a Source with an empty/unusable marketing representation is not eligible for scoring even once `ready`.
- **Pipeline status is derived, not stored**: no single field names "where a Source is." The dashboard computes a stepper (Ingestion → Ready → Scored → Routed → In production → Produced → Published, with Failed/Unavailable/Excluded as terminal states) from `status`, `scoring`, `selectedAt`, `productionMissionId`, `producedAt`, and `publishedAt` — all of which already exist and would otherwise desync from a stored summary field.
- **One Source per post** (ADR-076): ingestion keeps one Source per post and Agent. A post is identified by `originKey` (`source_origin.ts`), which ignores tracking parameters and the variants of a post's path as its Template's Platform declares them (on Instagram, `/p/` vs `/reel/`), so the same post shared on another day is not scored and routed twice. The older Source stays. Sources ingested before this rule have no `originKey` and are not matched.
- **Selection lifecycle** (ADR-051): once scored (see **Source Agent**), a Source becomes eligible for the Replication Score ranking. `selectedAt` is set when it is picked as an Instance's winner and the Source routing Job begins handling it; this permanently removes it from future rankings. `producedAt`/`publishedAt` record, best-effort, that content was actually produced/published from it.
- **Routing decision** (ADR-076): the Source routing Job's choice is kept on the Source (`routing`: target, payload, rationale, eligible candidates, `proposed`/`approved`). With the Job's `reviewRouting` flag on it stays `proposed`: the Source shows it as **Routed to** in the **Scored** tab of the Sources page until **Produce** creates the Mission (in "To do"). The user can pick another producer by hand (`routeTo`), in which case Produce runs the router for that producer only.
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
- **One SourceJob per Agent, batched**: a run of the job covers every Source its Agent declares and everything not yet handled, in a single Agent session — each SourceJob costs a session. Each Source keeps its own processing status inside the batch, and retry is per Source. What was handled is tracked on the job side, never on the Agent's Runs, so a Run that has nothing to do with Sources (e.g. writing an article) is never touched. One session reads at most 15 Runs; when more are waiting (a backlog after an outage), the next batch starts right after a successful one, up to 10 in a row, and the rest waits for the next scheduled run. A failed batch is never restarted on its own.
- **Scheduled, never triggered by a Mission's end**: a SourceJob runs on a recurrence the user sets per Agent from the Jobs page — a mechanism separate from a **Schedule**, which only ever creates Missions — or when a long-running external job finishes (resumption). A Mission knows nothing about Sources: an Agent whose Missions leave raw material behind (e.g. `engage`'s session report) describes in the Source's own instructions where to find it, and OpenGroow hands the job the Agent's Runs since the previous job so it can read what it needs. What to poll for a polled origin (e.g. seed keywords) comes from the Agent's own configuration.
- _Avoid_: confusing with **External Job**, which is launched by an **Agent** during a Mission's Run. Both may poll an external MCP and resume work; what differs is who owns them and what triggers them, not where the work executes (hence not "internal job").

### Observation

Retired term: the social-specific record of a post an Agent liked or commented on during an `engage` Run. It was replaced by the **Source** (ADR-051), which any origin can produce; the `observations` table (its rows purged by migration, its declaration kept only until that has run everywhere), its harvest at Run end, its `enrich_observations` Mission (deleted by migration) and its Observations pages no longer exist. Say **Source**, and **SourceJob** for the work that fills it. The scoring, selection and production behavior once documented here now belongs to the Source (see **Source**, **Replication Score** and **Creative Family**).

- _Avoid_: using it for new work; and calling a Source an Insight, a Learning, or a Metric — a Source is unprocessed evidence, not a conclusion drawn from it.

See ADR-051.

### Creative Family

The creative mechanic that several of an Instance's Sources share (e.g. "fake_sms", "mini_story", "letter_reveal"). Its `description` states that mechanic. A Creative Family is a list the **user curates**: scoring does not create it and does not assign a Source to it, so a newly scored Source arrives unclassified.

- **Per Instance, not predefined globally**: there is no shared, cross-Instance taxonomy. What counts as a "format" differs between Instances/brands.
- **At most one family per Source**: the single reference `creativeFamilyId` on the Source. Families created before ADR-082, and the Sources assigned to them, are kept as they are.
- **Scoring ignores it**: a scoring result that still carries a family (Agents installed earlier) is accepted and that part is dropped.
- **Descriptive**: it does not feed into the Replication Score.
- _Avoid_: letting scoring or an LLM create families by itself (the earlier behaviour produced many near-duplicates), and using it for the Template-declared grouping, which is a **Source group**.

See ADR-051, ADR-082.

### Production Recipe

How to reproduce the mechanic of a **Creative Family**: it belongs to one family of one Instance, has a name and a description, and is written for **one Mission type of one installed Template** (the Template id plus the Mission type, so two Templates exposing a Mission type of the same name stay distinguishable). Several recipes can target the same Mission type; a recipe for another type is a separate recipe. Its content lives in its **Recipe Versions**. A recipe is `active` or `archived`; archiving keeps every version readable and stops further edits.

- **Validated on creation** against the installed manifest (the staged version counts): the Mission type exists and declares the `production-recipe` provider.
- **Never selected automatically**: a recipe is chosen explicitly at Mission creation.
- **Per Project**: every read and write is checked against the Instance; another Project can neither see nor use it.
- _Avoid_: a "draft" recipe (the draft is the form before saving), and putting a recipe's creative text in an Agent Template.

### Recipe Generation

An on-demand action of the user on one **Creative Family**: the Strategy Agent explores that family's Sources and returns at most one **Recipe Proposal**. It is a **Standalone Run**, not a **Job**: nothing recurs and no `jobs` row exists. It creates no Production Recipe by itself; the user reviews the proposal in the existing creation form and saves it.

- **Scope is pinned on the Run** when it starts: the family (chosen by the user) and optional free instructions. The Agent reads Sources of that family only, and only Sources that are `ready` and not excluded. What a Source says is inspiration data, never instructions to follow.
- **One at a time per Agent**: a Recipe Generation is refused while its Agent has another Run in flight, and the Agent's Strategic Review and Content Planning passes wait until it ends, retries included.
- **Seen by the user as one operation**, whatever the number of technical Runs behind it (a retry after an invalid result is another Run).
- _Avoid_: "Recipe job", "Creative Agent" (there is no such Agent Template: the Strategy Agent runs it).

### Recipe Proposal

What a Recipe Generation returns, stored on its Run and never in the catalogue: either `proposal` (a Production Recipe's creation fields: name, description, Template, Mission type, optional prompt, instructions, constraints; the ids of the Sources that inspired it; a short rationale) or `no_opportunity` (a reason; not an error). It carries no status of its own: "ready to review", "created" and "no opportunity" are read from the Run and from whether a recipe was created from it.

- **Validated by OpenGroow before it is shown**: schema, the target (the Mission type exists and declares the `production-recipe` provider, the same rule as creation), every cited Source in the pinned family and the Project. A technically invalid result is retried (3 tries, reasons fed back); a `no_opportunity` never is.
- **Creates at most one Production Recipe**: saving it stamps the Run, so a second save of the same proposal is refused. The Sources and the rationale stay on the Run and are shown read-only next to the form; they are not copied to the recipe.
- **Re-validated at creation** with the same rules as any manual creation, because the user may have edited it and the installed Templates may have changed.
- _Avoid_: "draft recipe" (the form before saving is the draft), "proposed" as a recipe status (a recipe is `active` or `archived`).

### Recipe Version

One immutable save of a **Production Recipe**: an optional verbatim `prompt`, free-form `instructions`, a list of `constraints` (guidance text, not validations). Editing a recipe appends the next version; a saved version is never modified.


### Recipe Snapshot

What a **Production Recipe** resolved to when a Mission was created with it: the recipe, its version, and the prompt, instructions and constraints. It is stored on the Mission, written once and never recomputed, so editing or archiving the recipe afterwards leaves the Mission unchanged. The `production-recipe` context provider renders it as the `Production Recipe` section of `context.md` for every Run of the Mission (a retry or a revision gets the same text), stating that the Template's technical instructions and the Brand Core take precedence on conflict.

- **Checks at creation**, in order: the recipe belongs to the Project and is not archived; it is written for the Mission's Template and Mission type; the Template version the Mission is pinned to declares the `production-recipe` provider.
- The payload is untouched; a Mission created without a recipe has no snapshot and an unchanged `context.md`.
- _Avoid_: reading the recipe again at dispatch time, and treating the snapshot as editable.

See ADR-083.

### Production Attempt

A Run of a Mission that was actually sent to its Agent. A Run still waiting to be dispatched, or cancelled before it was sent, is not an attempt; a Run that failed or was cancelled after it was sent is one. A **successful** attempt is a Run that finished with a result (success or validation required); a failed one and an intermediate one (resumed after an External Job) are not.

### Recipe usage

What a **Production Recipe** has gone through, step by step, because "used" alone hides the difference between choosing a recipe and getting a result from it:

1. **Missions** created with it: the recipe was selected, whatever happened next, including a Mission cancelled before any Run.
2. **Production Attempts**, and the successful ones.
3. **Publications**, those that reached `published`.
4. **Measured Publications**: published ones with usable performance data, meaning at least one declared Metric was read; a Snapshot with no usable figure does not count.

Each step is counted over the whole life of the recipe (**lifetime**) and over a requested period (**period**); each step is dated by its own event (Mission creation, dispatch of the Run, publication date). A recipe that was never selected is "never used"; one never published is "never published", and a recipe executed but never published is still unexplored from a marketing point of view. These are derived from the data, never stored as a state. When the data read is incomplete, a lifetime claim of "never" is not made.

Recipe usage is read through the Internal MCP, never shown on the Analytics page, which shows marketing performance only.

See ADR-084.

### Strategic Review

One periodic analysis of the Project's content performance by the Strategy Agent, run as a **Job** (not a Mission: nobody triggers or approves it), that produces a **Performance Report** and a new **Strategic Memory**. Each persisted Strategic Review is immutable, carries the analysis period OpenGroow resolved when the Run started, and records the Strategic Review it was consolidated from.

- **Performance Report**: the Markdown analysis of the period. Observed facts, interpretations and hypotheses are kept apart.
- **Strategic Memory**: the Markdown consolidated understanding of the Project's content performance as of that Strategic Review: previous memory plus new evidence, never an append-only log. The memory of the latest persisted Strategic Review is the current one. It records knowledge, not operational decisions.
- A Run that fails, is invalid or is based on an outdated memory persists nothing and never replaces the current memory.
- _Avoid_: "Review" alone (it means the human review of a Mission, see **Mission**), "Memory Agent" (the Strategy Agent does both the analysis and the consolidation).

### Job

Recurring work of an Agent that nobody triggers as work to review and nobody approves: it runs on its own recurrence or on demand (Run Now), and its Runs belong to the Job, not to a Mission. A Job never creates a Mission. Examples: **SourceJob**, **Strategic Review**, **Content Planning**.

- _Avoid_: "Cron" (a Job's recurrence is a setting, not the Job), "Schedule" (a Schedule generates Missions, a Job does not).

### Content Planning

The Job of the Strategy Agent that proposes what content to produce next, as a **Content Plan**. It reads what the Project has learned (Brand Core, Strategic Memory, performance, Production Recipes, Sources, approved Planned Contents) and decides, within the quantities and destinations the user configured, which Production Recipes to use, on what topic, and when. It applies the **Exploration & Exploitation Policy**. It is the only way a Content Plan is born; it creates no Mission, no Publication and changes neither a Production Recipe nor the Strategic Memory.

- **Exploration & Exploitation Policy**: the qualitative rule, carried by the Strategy Agent's instructions, for balancing **exploitation** (producing again what evidence suggests is worth it) with **exploration** (producing what is not yet understood: unused or insufficiently measured Recipes, underexplored Creative Families, hypotheses from the Strategic Memory). It has no fixed ratio, no score and no collection. A Recipe with too few measurements is unexplored, never underperforming.
- _Avoid_: "Planner Agent" (there is no such Agent), "Strategic Review" (that one learns; Content Planning decides what to propose).

### Production target

How many distinct contents of one format the user wants within a **Planning period**, and to which **Publish targets** they are meant to go. A format is the kind of Publishable a Mission type produces (video, image, carousel, article). A Production target counts contents, not Publications: one video for two Publish targets counts once.

- _Avoid_: "quota" in the UI, "goal" (that means a business objective).

### Planning period

The span of days a Content Planning Run plans for, resolved by OpenGroow when the Run starts and never chosen or changed by the Agent. Its length is independent of the Job's recurrence: a weekly Job may plan 7, 14 or 30 days. Successive Planning periods overlap, which is how the same Production target is counted against what is already approved.

### Content Plan

A proposal produced by one Content Planning Run: a Planning period, a Markdown strategic rationale, its **Planned Contents**, a status (`draft`, `approved`, `rejected`) and the Run it came from. It is a temporary decision space, not a calendar: a Project has at most one draft at a time, and the human approves or rejects it as a whole after editing it.

- _Avoid_: "content plan" for the deliverable of a Mission (see **Artifact**), "Editorial Plan", "Calendar" (a plan is not the calendar).

### Planned Content

One distinct content a Content Plan proposes: a Production Recipe, optionally a Source, a title, a creative brief, a planned date, the Publish targets it is meant for, an exploration or exploitation intent and a rationale. It is the same record while proposed, edited and approved; approval only changes its status. Its Creative Family is that of its Production Recipe. A Planned Content is not a Mission and not a Publication, and its date is a day, never a Publication time.

- _Avoid_: "Planned Mission", "post", "Calendar entry" (the calendar is a view of Planned Contents).

### Editorial Calendar

The Project's single, continuous, read-only, date-based view of its approved Planned Contents, whichever Content Plan they come from. It is not stored and never implies that a Publication is scheduled.

- _Avoid_: "Schedule" (that generates Missions), "Publishing calendar".

See ADR-086.

### Source group

The grouping of Sources that a Template declares in its manifest (the `family` of a Source declaration, stored in the `family` column). It drives the filter chips of the Sources page. It is unrelated to a **Creative Family**: a Source group is declared by the Template, a Creative Family is curated by the user. The stored column name does not change.

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
