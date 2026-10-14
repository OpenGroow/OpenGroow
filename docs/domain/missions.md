# Missions, Runs, Artifacts and Brand Core

Part of the OpenGroow glossary: see [GLOSSARY.md](../../GLOSSARY.md) for the vision, bounded contexts and term index.

### Mission

User intention: a task assigned to an Agent, with a defined business objective. The Mission is the unit of work from the user's point of view.

- A Mission has a `type` (e.g. `seo_article`), a `payload` (specific parameters), and a status.
- **Mission statuses**:

| Status        | Canonical UI term | Business meaning                                                                   |
| ------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `todo`        | To do             | Created, not yet launched                                                          |
| `doing`       | In progress       | A Run is in progress                                                                |
| `to_validate` | To validate       | The Agent is waiting for a human decision                                          |
| `approved`    | To publish        | The human has validated the deliverable; publication pending (human or agent). Statuses are not blocking — each mission type follows its own path to `done`. |
| `done`        | Done              | Completed successfully — deliverable published                                     |
| `failed`      | Failed            | Terminal failure                                                                    |
| `blocked`     | Blocked           | The Agent hit a blocker declared by its Agent Template: a human must act outside OpenGroow — on a responsible MCP dashboard, an Execution device, or another external system — before this Mission can make progress (cf. `RunResult` branch `blocked_external`). Not a failure and not a OpenGroow review. |
| `cancelled`   | Stopped           | An operator deliberately interrupted a Mission that was `doing`, via the **Stop** action on the Mission detail page: best-effort, killing the local OpenClaw agent process if one is still running (idempotent — no matching process is still a successful Stop). Terminal. **Do not confuse** with `failed`, which means the Agent or the infrastructure errored out — `cancelled` is a human decision, not a fault. A stopped Mission is **not** relaunchable today (unlike `failed`/`blocked`); whether it should be is deliberately left open. **Limitation**: when the live Run has already handed off to an Intermediate External Job (`awaiting_job`, ADR-026), there is no local agent process to kill and the external job itself is **not** cancelled — Stop only prevents OpenGroow from resuming/polling it further, it does not guarantee the Mission stopped burning quota on the external service. |

> **UI language: English.** All labels visible to the user are in English (cross-cutting decision — see ADR). The technical keys (`todo`, `doing`…) were already English; now the **canonical UI terms** are too.

- A Mission is associated with an Agent Template and an Instance. It can produce several **Runs** (relaunches, retries).
- **Context injected at execution time**: for each Run, OpenGroow composes a `context.md` from four independent layers: (1) the Mission's type and Payload, (2) the Project's Brand Core, (3) the result of the last Run if the Mission is under review, (4) the Template's instructions (`AGENTS.md`). A Template may add its own **Run context** section, declared in its manifest (`runContext`): fixed references to the Run id, Agent config keys, Mission payload keys and relative dates, substituted as plain text — never code (#659). Logic beyond substitution (Social Engagement choosing the account of the Mission's platform, failing loudly when it is unknown or unconfigured) lives in a named core **context provider** the manifest references in `contextProviders`; an unknown name is refused at validation (#660). These layers are assembled by the dispatcher and written to the Workspace — the agent does not contact OpenGroow to obtain them.
- Statuses form a **non-blocking Kanban**: transitions are not enforced by the system — each mission type follows its own path to `done`. Example: a mission with no publishable deliverable goes directly from `to_validate` to `done`; an SEO mission goes through `approved`.
- For a Mission whose proposed actions must be validated before execution, human validation creates a new Run of the same Mission. This Run receives the approved and modified actions, executes them, then produces the terminal result.
- **Waiting for device**: UI indication carried by a Mission still `todo` when the Agent depends on an execution device that is temporarily unavailable or exclusively occupied by another Run. This is neither an additional Mission status nor a failure: the Run stays pending and can start as soon as the device becomes available again. **Do not confuse** with `blocked`: "Waiting for device" applies before any Run has started; `blocked` is a real terminal `RunResult` — the Run did execute and stopped cleanly on a blocker requiring human action outside OpenGroow.
- A `blocked` Mission can be manually relaunched by the user (new Run on the same Mission), the same mechanism used to relaunch a `failed` Mission — once the human has resolved the declared blocker, the new Run picks up normally.
- **Available device**: execution device associated with the Agent, connected, authorized, unlocked, and whose control service is responding. The application targeted by the Mission does not need to already be open. _Avoid_: online (too vague), ready (without specifying the device).
- **Execution device**: single physical device associated with an Agent that depends on it. For V1, an Agent uses exactly one Execution device; several Agents may share that device, but only one device-dependent Run may control it at a time. Missions and Runs inherit this association without choosing a device themselves. This association belongs to the Agent's reconfigurable config, but cannot change during an active Run. _Avoid_: Device (in business language), target phone.
- Reviewable Missions use a **generic review page** driven by the Agent Template's contract. The Template declares the content, inputs, and available actions; the page is not coded per Mission type.
- **Deletion**: the user can **permanently delete** a Mission (hard delete, irreversible). Deletion **cascades to its Runs** (the aggregate is destroyed along with its root) but does not touch the infra log (Commands, Events) nor the number counter — the `number` remains "stable for life," a gap in the sequence is normal. Forbidden while a **Run is alive on the Instance** — i.e. `dispatching` (execution command being sent) or `running` — because its callback (Event/RunResult) would reference a Mission that no longer exists. A `pending` Run is only queued on the Convex side (not yet claimed by the dispatcher) and is swept away by the cascade: a Mission **stuck in `todo`** therefore remains **deletable**. In practice: `doing` is always forbidden (Run `running`); a `todo` is forbidden only during the brief instant its Run transitions to `dispatching`. No domain event is emitted (hard delete without trace, by design). _Canonical UI term_: "Delete". _Avoid_: archive (there is no soft-delete).

#### Mission Identity

A Mission is identified by humans through three elements, distinct from its technical `_id`:

- **Number**: sequential integer **per Project** (`#1`, `#2`, `#3`…), assigned at creation, stable for life and increasing across all types combined. It is the identifier citable out loud (_"look at mission 14"_). The Convex `_id` is never displayed.
- **`name`**: short label, fixed **at creation**, readable from the `todo` status onward. For a **manual** mission, it can be entered by the user; if omitted or left blank, a default label is auto-derived from the mission's type and number (e.g. _"create_article #14"_) — so the form is not blocking. For a **scheduled** mission, it takes **the Schedule's name** that spawned it (e.g. _"Schedule #23"_) — the label itself then carries the word "Schedule," which is enough to signal its origin (no separate visual indicator). The `name` is therefore always present; the card never falls back to an empty label.
- **`summary`**: summary produced by the **Agent** during execution (from `doing` onward), in a **strict format** that **every Agent Template must honor** (a short, bounded line of text). Free text, type-agnostic: the UI layer displays it **verbatim** without ever parsing the `payload`. It is what reveals the mission's actual function once it has been picked up.
  - **Write channel**: early in its Run, the Agent calls a **dedicated tool** (HMAC REST endpoint → Convex) that writes **only** the `summary` on the Mission. This tool **never touches `status`**: the status remains derived from the Run/RunResult lifecycle (cf. `runs.markCompleted`). Letting an Agent push an arbitrary status would violate the "status derived from the Run" invariant and the aggregate rule.

> On the board, a card displays the `summary` as soon as it exists (mission ≥ `doing`), otherwise the `name`. `name` and `summary` are **two distinct fields**: the `name` (and hence the "Schedule" origin) remains visible even after the Agent has written its `summary`.

### Schedule

Recurrence rule that automatically generates **Missions** at a defined cadence, without user intervention.

- A Schedule belongs to a **Project** and targets an **Agent** (hence a `templateId`). It fixes the `type` and `payload` of the Missions it will produce.
- A Schedule is a **Mission factory**, not a Mission: each trigger creates an ordinary, independent one-off Mission (which then follows its own `todo → … → done` cycle).
- A Schedule is either `active` or `paused`. While `active`, it triggers at its cadence; when `paused`, it no longer triggers but stays configured.
- From the user's point of view: _"an SEO article every Monday morning"_.
- _Avoid_: Cron, Job, Scheduled task (infra jargon, banned from the UI).

### Run

Attempt to execute a Mission by an Agent. The Run is the technical concept of an execution; the Mission is the intention that triggers it.

- **Mission/Run relationship**: 1 Mission → N Runs. If a Run fails or is manually relaunched, a new Run is created for the same Mission.
- A Run has an `agentName`, a `sessionKey` (OpenClaw session identifier), and a **RunResult** upon completion.
- **Run statuses**:

| Status         | Meaning                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`      | Created, waiting for dispatch                                                                                                       |
| `dispatching`  | Command being sent to the Instance                                                                                                  |
| `running`      | The Agent is actively executing the Mission                                                                                         |
| `awaiting_job` | The Agent has handed off an External Job and stopped; OpenGroow polls the external service until a terminal state (cf. External Job) |
| `completed`    | Finished (success or validation required)                                                                                           |
| `resumed`      | An intermediate External Job (cf. External Job) has finished; no RunResult — the Mission has started a new `pending` Run           |
| `failed`       | Terminal failure                                                                                                                     |
| `cancelled`    | An operator stopped the Mission (cf. Mission status `cancelled`): the agent process was killed on the Instance. Terminal, and never re-polled — reconciliation only ever selects `dispatching`/`running`/`awaiting_job`, so a late exec result can no longer re-decide this Run's fate |

### Blocker

A human-action condition declared by an Agent Template that can stop one of its Missions outside OpenGroow's own review flow. Each Template owns its blocker vocabulary and resolution kind; the Run carries the concrete blocker and its runtime message, while the dashboard renders all blockers through one generic Blocked surface. _Avoid_: treating a Template-specific blocker as a generic failure or as a `needs_human_review` decision.

### RunResult

Terminal value produced by a Run upon completion. Discriminated into four branches:

| Branch               | UI term         | Meaning                                                                                                                                               |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success`            | Done            | The Agent has accomplished the Mission and can produce an Artifact.                                                                                    |
| `needs_human_review` | **To validate** | The Agent has stopped and is waiting for a decision or information from the user before it can continue. Contains concrete `reviewQuestions`.          |
| `failed`             | Failed          | The Agent has encountered an unrecoverable error. Contains an `error.code` and an `error.message`.                                                      |
| `blocked_external`   | **Blocked**     | The Agent has stopped because a human must act outside OpenGroow — on a responsible MCP dashboard, an Execution device, or another external system. The concrete blocker is declared by the Agent Template and carries its own resolution data. |

> **"To validate"** is the canonical UI term for `needs_human_review`. Never display "needs_human_review" to the user. **"Blocked"** is the canonical UI term for `blocked_external`. **Do not confuse** `blocked_external` with `needs_human_review`: the latter is a decision made *inside* OpenGroow's generic review page (`reviewQuestions`, approve/reject/publish); the former points *outside* OpenGroow — possibly to an MCP dashboard or an Execution device — and has nothing to review in OpenGroow itself.

### Intermediate Result

**Non-terminal** value produced by OpenGroow upon completion of an **intermediate External Job**. Unlike `RunResult`, it does not close the Run: it carries the produced content (e.g. an article plan, a reason for blocking) in a dedicated Mission field, injected into the `context.md` of the same Mission's next Run — replaced (never accumulated) at each new resumption.

- Never viewable by the user — it is an internal agent-to-agent handoff, not an Artifact.
- _Avoid_: confusing it with `lastResult`/Artifact — those carry a terminal value resolvable by the user; the Intermediate Result is neither terminal nor intended for the user.

### External Job

Long-running asynchronous work launched by an Agent in an external service during a Run. An External Job is distinct from the OpenGroow Run: the Agent starts the work, hands off a job reference to OpenGroow, then OpenGroow tracks progress until it obtains an Artifact or a failure.

- An Agent must not stay active solely to wait for an External Job to finish.
- The non-terminal **Handoff** of an External Job carries only the facts observed by the Agent: job type and external reference of the launched job. The tracking and transformation contract is carried by the Agent Template. OpenGroow polls the external service via a generic engine, interprets the status according to this contract, then resolves completion depending on the External Job type (terminal or intermediate, see below).
- The Agent Template maps an External Job's terminal states to the expected OpenGroow state.
- Tracking External Jobs is a loop distinct from launching Agent Runs: launching an Agent and tracking external work handed off by the Agent are two different responsibilities.
- _Avoid_: calling an External Job's identifier "Run ID" in common language; "Run" designates the OpenGroow attempt.

**Terminal External Job**: its completion directly transforms the observed state into a terminal **RunResult** (`success`/`needs_human_review`/`failed`), a Mission status, and an optional **Artifact**. This is the default case (e.g. article generation).

**Intermediate External Job**: its completion closes neither the Run nor the Mission — it produces an **Intermediate Result** (cf. RunResult) and starts a new Run for the same Mission, which resumes in `doing`. Used when a long step must be followed by a decision or continuation made by the Agent itself, without human validation (e.g. an article plan the Agent must judge valid before continuing). _Avoid_: treating an intermediate External Job as producing an Artifact — its result is never viewable by the user.

### Artifact

Business deliverable produced by a Run, viewable by the user. An Artifact is a **generic, structured pointer** to the content produced by the Agent — not a container for the content itself.

- An Artifact identifies the deliverable type and the external reference that lets OpenGroow retrieve it from the responsible service. Identifiers specific to an external service (e.g. article identifier, video render identifier) belong to the Template's integration, not to the common UI contract.
- An Artifact's external reference is named **`external`**: it indicates the service responsible for the deliverable and the deliverable's identifier within that service. OpenGroow then resolves the content from this reference.
- The service referenced in `external` is a server declared by the Agent Template that produced the Artifact. An Artifact never carries an environment URL.
- An Artifact's metadata is used only for display and context. It does not carry the deliverable's identity and must not be required to resolve its content.
- A behavioral-analysis Artifact can take the form of an exhaustive **Decision Report**: each observed element appears with the Agent's decision, its justification, and the action possibly executed. Ignored elements remain visible so the human can assess false positives and false negatives.
- A Decision Report covers a bounded **Engagement Session**, with no quota of decisions: the Agent evaluates each element on its relevance and does not aim for a minimum or maximum number of interactions.
- **Engagement Session**: time window (typically 5–10 minutes, randomized) during which the Agent browses a feed and makes its decisions. The bound is temporal, not a fixed number of elements. If the Session is interrupted, the Agent produces a partial Decision Report indicating where and why it stopped; the Mission moves to `to_validate` so the human can review the incomplete result. Several Sessions per day are scheduled via OpenGroow **Schedules** — the daily rhythm is a scheduling concern, not the Agent's.
- A Decision Report produced from an Execution device can remain in the Agent's local Workspace. Viewing it then depends on that Workspace's availability; OpenGroow does not yet guarantee its replication or preservation after reprovisioning.
- For Plugin Agents (e.g. Android), the deliverable can reside in the Workspace rather than in an external service. In this case, `external.service = "workspace"` and `external.id` is the relative path of the main file within the Workspace (e.g. `missions/<missionId>/artifacts/<runId>/report.json`). The dashboard loads this content via a Convex action dedicated to workspace artifacts, instead of the proxy to an external service. This convention is declared in the Template like any other Artifact.
- The actual content (Markdown, video, image, JSON…) lives in the **external service** that produced it. OpenGroow does not duplicate it.
- Examples: _SEO article on "running shoes"_ (content at the SEO service), _short video from a newsletter_ (content at the video service), _TikTok content plan week 21_.
- An Artifact is attached to a RunResult of type `success` or `needs_human_review`.

### Marketing Mock

Illustrative, fictional demonstration of a product behavior intended to make
the product promise concrete for an audience. A Marketing Mock is not a
faithful reproduction of the production Agent's internal behavior and must
not imply that every detail shown is already implemented.

- The scenario and dialogue may be invented for clarity and emotional impact.
- The mock must remain faithful to a small, explicit set of observable product
  behaviors (for Acme: acknowledge both perspectives, reframe the conflict,
  and suggest a constructive next step).
- Acme appears in the mock as a **Facilitator**: neutral toward the people,
  attentive to each person's experience, and focused on a constructive next
  step. A Facilitator does not diagnose, arbitrate who is right, or speak as a
  therapist.
- Neutrality is not false equivalence: the Facilitator may acknowledge both
  experiences while naming harmful behavior, setting a boundary, or asking for
  repair. Understanding a feeling does not mean approving the behavior that
  caused it.
- The expected outcome is **progress**, not guaranteed resolution: a
  participant may soften, acknowledge responsibility, or agree to one concrete
  next step, while the underlying conflict remains open.
- The mock must not imply unsupported capabilities such as diagnosis,
  guaranteed resolution, or exact parity with the production product.
- _Avoid_: calling it a **Simulation** when that could be understood as a
  technically faithful simulation of Acme.

### Brand Core

Persistent business knowledge, **curated by the human**, attached to a **Project**, read by **all Agents** of the Project to contextualize their work. It is the brand's identity core from which each Agent derives context relevant to its Mission.

- **Written by the human, static**: it evolves slowly, at the user's initiative. Agents **read** it, never write it. Machine-written memory is **not** out of scope for OpenGroow as a whole — the **Source** is its first instance — but it lives beside the Brand Core, never inside it: no Agent ever edits the Brand Core.
- Example content: audience, tone, offering, positioning, editorial rules, constraints, things to avoid, brand voice, personas, competitors, forbidden messaging.
- **Scope: a single Brand Core per Project.** Since an Instance runs the Agents of a single Project, the Brand Core is naturally shared by all Agents of that Instance.
- **Do not confuse** with: an MCP _resource_ (MCP protocol term); a Run's _runtime context_ (the `.md` injected per Run). The Brand Core is upstream, stable, and feeds this Run context.
- **Composition at execution time**: each Run receives the Brand Core (project-level, global layer) composed with the Template's instructions (`AGENTS.md`) and the Agent's `config` (specific layer). The Brand Core is the **shared layer** from which each Agent derives context relevant to its Mission. The projection is regenerated on each execution: an edit to the Brand Core is taken into account on the next Run, never mid-Run.
