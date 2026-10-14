import type { MachineToolInstall } from "./machine-tool";
export type McpServerConfig = {
  name: string;
  transport: string;
  url: string;
  /** Convex-only: URL used to call the MCP server directly from Convex (e.g. activation hooks). Stripped before sending to the runtime. */
  activationUrl?: string;
  /** Convex-only: public base URL for serving assets (e.g. video files). */
  publicBaseUrl?: string;
  /** Convex-only: extra headers sent to the MCP server from Convex. */
  headers?: Record<string, string>;
  callTimeout?: number;
};

/**
 * A bounded declarative HTTP effect declared by a Template action.
 * OpenGroow interprets and executes these effects; a Template must NOT
 * contain arbitrary JavaScript or code references.
 *
 * Supported interpolation references in `path` and `body`:
 *   - `{id}`          → artifact.external.id
 *   - `{input.<key>}` → user-supplied action input
 */
export type BoundedHttpEffect = {
  /**
   * The MCP server name (from `mcpServers`) to call. Convex resolves
   * the URL from the manifest — the Template never embeds raw URLs.
   */
  server: string;
  /** HTTP method. Only POST is supported for mutating actions. */
  method: "POST";
  /**
   * Path relative to the server origin. Supports `{id}` and
   * `{input.<key>}` interpolation.
   * Example: "/articles/{id}/approve"
   */
  path: string;
  /**
   * Optional JSON body template. Keys whose values are interpolation
   * references are resolved at execution time; all other values are
   * passed through verbatim.
   * Example: { "publishDate": "{input.publishDate}" }
   */
  body?: Record<string, string>;
  /**
   * Optional response field to extract an `IndexingOutcome` from.
   * If present, Convex extracts this field from the response JSON
   * and passes it to the `markDone` transition.
   * Example: "indexing"
   */
  responseIndexingField?: string;
};

/**
 * A bounded declarative "revision Run" effect declared by a Template reject action.
 * Instead of making an external HTTP call, OpenGroow creates a new Run for the same
 * Mission carrying the human feedback and moves the Mission back into active work.
 *
 * The `feedback` input key names the required ReviewActionInput that holds the
 * rejection reason. OpenGroow validates the input is non-empty before creating the Run.
 */
export type RevisionRunEffect = {
  kind: "revision_run";
  /**
   * The ReviewActionInput key that carries the human feedback string.
   * Typically "feedback". Convex reads `input[feedbackKey]` and stores it as
   * `humanFeedback` on the new Run so Agent revision instructions keep working.
   */
  feedbackKey: string;
};

/**
 * Mission status transition to apply after a successful action effect.
 * - "approved" → markApproved
 * - "done"     → markDone (with optional indexing outcome)
 * - "doing"    → mission moves back to active work (used by reject/revision)
 */
export type ReviewActionTransition = "approved" | "done" | "doing";

/**
 * A single review action capability declared by a Template.
 * The `key` is the canonical capability name used by the dashboard.
 */
export type ReviewActionCapability = {
  /**
   * Canonical capability key. Supported values: "approve" | "publish" | "reject".
   * - "approve" and "publish" execute a bounded HTTP effect and transition Mission state.
   * - "reject" creates a revision Run with human feedback and moves Mission back to "doing".
   */
  key: "approve" | "publish" | "reject";
  /**
   * UI label for the action button. Configurable independently of the
   * capability key (e.g. `approve` can display as "Validate").
   */
  label: string;
  /**
   * The mission status required before this action can be executed.
   * Convex enforces this as a precondition.
   */
  requiredStatus: "to_validate" | "approved";
  /**
   * Optional user input fields required by this action.
   * The dashboard renders these inputs before the action can be submitted.
   */
  inputs?: ReviewActionInput[];
  /**
   * The effect to execute when the action is triggered.
   * - BoundedHttpEffect: call an external service (approve/publish).
   * - RevisionRunEffect: create a revision Run with feedback (reject).
   * - absent: pure Mission transition with no external side-effect.
   */
  effect?: BoundedHttpEffect | RevisionRunEffect;
  /** Mission status transition applied after a successful effect (or immediately if no effect). */
  transition: ReviewActionTransition;
};

/** A user input field declared by a review action. */
export type ReviewActionInput = {
  /** Field key — matches `{input.<key>}` in BoundedHttpEffect interpolation. */
  key: string;
  /** UI label rendered next to the input. */
  label: string;
  /** Input type. "datetime-local" maps to a datetime picker in the dashboard. */
  type: "text" | "datetime-local";
  /** Whether this field must be non-empty before the action can be submitted. */
  required: boolean;
};

/**
 * Review content contract declared by an Agent Template.
 * Describes what kind of content to present during human review
 * and how to load it from the external service.
 *
 * Two variants:
 * - `service: "workspace"` — content is read from the agent's OpenClaw
 *   workspace via the runtime command protocol; no MCP server needed.
 * - (default) — content is fetched from an MCP server declared in
 *   `mcpServers` at the given `path`.
 */
export type ReviewContentContract =
  | {
      kind: "markdown" | "metadata" | "image" | "video";
      /** Signals that the deliverable lives in the agent's workspace. */
      service: "workspace";
      actions?: ReviewActionCapability[];
    }
  | {
      kind: "markdown" | "metadata" | "image" | "video";
      /**
       * The MCP server name (from `mcpServers`) that holds the content.
       * Convex resolves the server URL from the Template manifest.
       */
      server: string;
      /**
       * REST path to fetch the content, relative to the server origin.
       * Supports `{id}` interpolation from `artifact.external.id`.
       * Example: "/articles/{id}"
       */
      path: string;
      /** Optional public image path to display alongside the review content. */
      coverPath?: string;
      actions?: ReviewActionCapability[];
    };

/**
 * Mapping of external job status values to OpenGroow terminal states.
 * OpenGroow fetches the polling endpoint and checks the `statusField` of the
 * response JSON against these lists to decide what to do next.
 */
export type ExternalJobTerminalStateMap = {
  /**
   * External status values that indicate successful completion.
   * On match: OpenGroow writes a terminal RunResult and the declared Artifact.
   */
  completed: string[];
  /**
   * External status values that indicate a failure.
   * On match: OpenGroow marks the Run and Mission as failed.
   */
  failed: string[];
};

/**
 * Template-declared contract for polling an External Job.
 * Uses MCP tool calling (ADR-020, ADR-013): the status of a long-running job
 * is polled via an MCP tool on the server declared in `mcpServers`. This is
 * consistent with how the Agent started the job; OpenGroow owns the polling
 * loop (calling the tool from Convex) rather than requiring the Agent to poll.
 *
 * Note: ADR-013 prefers REST for Convex→service calls, but cannot be satisfied
 * while the service exposes status ONLY via MCP (no REST status endpoint).
 * This contract correctly describes what the real service exposes.
 */
export type ExternalJobPollingCore = {
  /**
   * The MCP server name (from `mcpServers`) to poll.
   * Convex resolves the MCP URL from the manifest.
   */
  server: string;
  /**
   * The MCP tool name to call to get job status.
   * The tool is called with `{ runId: jobId }` (the external service's job identifier).
   * Example: "get_run_status"
   */
  mcpTool: string;
  /**
   * The field in the tool's JSON response that holds the status string.
   * Example: "status"
   */
  statusField: string;
  /** Maps external status strings to OpenGroow terminal states. */
  terminalStates: ExternalJobTerminalStateMap;
  /**
   * Optional (issue #455): when true, the whole poll response body
   * IS `job.output` — not the conventional `payload.output` nesting most
   * services use. an analysis MCP's `get_analyze_reel_status` returns its
   * completed payload's `raw`/`observation` at the top level, with no
   * `output` wrapper at all. Defaults to `false` (the pre-existing,
   * `payload.output` behavior) so every other service's contract is
   * unaffected.
   */
  outputIsRoot?: boolean;
};

/**
 * Mission-only External Job contract: the shared polling core plus the fields
 * describing what a completion means for a Mission (issue #528). A Source's
 * external-jobs block uses only `ExternalJobPollingCore`.
 */
export type ExternalJobPollingContract = ExternalJobPollingCore & {
  /**
   * Optional: the field in the completed poll response's `output` object that
   * holds the artifact's external id. If absent, the polling `jobId` is used
   * as `artifact.external.id` (current behavior for video).
   * Required when the artifact id differs from the polling id.
   * Example: "articleId" — when `get_article_status` returns `{ output: { articleId } }`.
   */
  resultIdField?: string;
  /**
   * The RunResult status to write when the job completes successfully.
   * - "needs_human_review": human validation required before Mission is done.
   * - "success": Mission goes directly to done.
   */
  resultStatus: "needs_human_review" | "success";
  /**
   * The Artifact kind to store on the completed RunResult.
   * Matches the `review.kind` in the same Template so the review renderer
   * knows how to display the deliverable. Drives `buildJobArtifact` so the
   * Template — not hardcoded service-name checks — determines the kind.
   */
  artifactKind: "markdown" | "metadata" | "image" | "video";
  /**
   * What this job's completion means for the Mission (ADR-026). No implicit
   * default — every contract must declare this explicitly:
   * - "terminal": completion produces a terminal RunResult (per `resultStatus`),
   *   a Mission status transition, and an Artifact. This is the existing,
   *   default behavior (e.g. `generate_article`).
   * - "resume_mission": completion produces an Intermediate Result instead —
   *   a non-terminal value written onto the Mission and injected into a
   *   freshly created Run for the same Mission, which stays `doing`. No
   *   RunResult, no Artifact, no human review; `resultStatus`/`resultIdField`/
   *   `artifactKind` are ignored on this path.
   */
  onComplete: "terminal" | "resume_mission";
  /**
   * What a declared *failed* terminal state (or a job-failure surfaced as an
   * MCP tool error, e.g. a validation 400 from the external service) means
   * for the Mission. Optional, defaults to `"terminal"` (the pre-existing
   * behavior: `markFailed`, the Mission ends `failed`). Mirrors `onComplete`
   * but for the failure path:
   * - "terminal": the Run and Mission fail permanently (existing default).
   * - "resume_mission": the same "resume with an Intermediate Result"
   *   mechanism as `onComplete: "resume_mission"` is reused for the failure —
   *   a fresh Run is dispatched for the same Mission with the job's error
   *   injected into context.md, so the Agent can see what went wrong (e.g.
   *   `letter.title` over the Letter service's 29-char limit) and correct its
   *   Manifest before retrying. Capped by `MAX_RETRYABLE_JOB_FAILURES`
   *   (see `external_job_polling.ts`) — beyond that the Run/Mission fails
   *   permanently like `"terminal"`, so an Agent that keeps repeating the
   *   same mistake cannot loop forever.
   */
  onFail?: "terminal" | "resume_mission";
};

/**
 * A Source's external-jobs block (issue #533): the shared polling core plus
 * how a failure maps onto the Source's status. A declared-failed job whose
 * error code is listed in `unavailableErrorCodes` (the service's own "this
 * cannot be analyzed" codes, e.g. a deleted or private post) leaves the Source
 * `unavailable` (never retryable); any other failure leaves it `failed`.
 */
export type SourceExternalJobPollingContract = ExternalJobPollingCore & {
  unavailableErrorCodes?: string[];
};

/**
 * The non-terminal External Job handoff shape written by an Agent.
 * Distinct from a terminal RunResult: the Agent does NOT poll the job itself.
 * It simply records the job reference and stops; OpenGroow owns the polling.
 *
 * In the RunResult JSON schema this maps to `status: "in_progress"`.
 * This TypeScript type documents the intended semantics clearly.
 */
export type ExternalJobHandoff = {
  status: "in_progress";
  summary: string;
  reviewQuestions: string[];
  job: {
    /** The MCP server name that hosts the background job. */
    mcpServer: string;
    /** The job identifier in the external service. */
    jobId: string;
    /**
     * The tool name of the job that was dispatched (e.g. "generate_article",
     * "generate_internal_links", "produce_video"). Disambiguates which of a
     * Mission type's job contracts applies when a Mission type has more than
     * one External Job contract (ADR-026).
     */
    jobType: string;
    /**
     * SourceJob execution only (issue #533): the `id` the Source write route
     * returned for the `processing` Source this job enriches. Names which
     * Source the job belongs to, hence which `externalJobsBySource` contract
     * applies. Never used by a Mission.
     */
    sourceRef?: string;
  };
};

/**
 * A single typed payload field declared by a Mission type (issue #300).
 * Interpreted generically by the dashboard's shared payload form renderer —
 * no `switch (missionType)` anywhere. Mirrors the shape of
 * `LeafRequirementField` (text/select) but scoped to Mission payload data
 * rather than Agent config.
 */
export type MissionPayloadField = {
  /** Field key — matches the key written into the JSON payload object. */
  key: string;
  /** UI label rendered next to the input. */
  label: string;
  /** Whether this field must be non-empty before the Mission can be created. */
  required?: boolean;
} & (
  | { type: "text" }
  | {
      type: "select";
      /** Fixed set of allowed values, e.g. an external service's enum. */
      options: SelectRequirementOption[];
    }
  | {
      type: "number";
      /** Inclusive lower bound, when the field is range-bounded. */
      min?: number;
      /** Inclusive upper bound, when the field is range-bounded. */
      max?: number;
    }
);

/**
 * A selectable mission type declared by an Agent Template.
 * `type` is the agent-interpreted string written on the Mission.
 * `label` is the human-readable option shown in the dashboard <select>.
 * `payload` is a JSON-serialised default payload that pre-fills the form
 * when this type is selected.
 *
 * Mission type is UI convention only — the backend never switches on it.
 * Templates without `missionTypes` fall back to a free-text type input.
 */
export type MissionType = {
  type: string;
  label: string;
  /** Optional routing description for Source Agents choosing a producer. */
  description?: string;
  /** JSON-serialised default payload string (e.g. `'{"keyword":""}'`). */
  payload: string;
  /**
   * Per-mission instruction file (relative to the template directory).
   * The dispatcher composes the base `AGENTS.md` with this file's content at
   * dispatch time, so the agent only loads instructions relevant to its
   * current mission type. Every Mission type declares its own dedicated path.
   */
  agentsMd: string;
  /**
   * Optional typed field schema for this Mission type's payload (issue #300).
   * When present, the dashboard renders a generic form (text/select inputs)
   * bound to the payload's keys instead of a raw JSON textarea, and validates
   * required/select fields client-side before Mission creation. Absent for
   * Mission types with no meaningful payload shape — form falls back to the
   * JSON textarea (unchanged behavior).
  */
  fields?: MissionPayloadField[];
  /** Per-Mission-type soft session length, in milliseconds. */
  sessionDurationMs?: { min: number; max: number };
  /** Review content and actions for this Mission type, when it is reviewable. */
  review?: ReviewContentContract;
  /** Human-action blockers that this Mission type may emit. */
  blockers?: AgentBlocker[];
  /**
   * Declarative context providers for this specific Mission type (issue #454).
   * Takes precedence over the Template-level `contextProviders` when present —
   * a Template whose Mission types have different information needs (e.g.
   * `routing` needs its source, `engage` doesn't)
   * declares providers per Mission type instead of every Run of
   * every Mission type paying for every provider's fetch.
   */
  contextProviders?: string[];
};

/** How a human resolves a Template-declared Mission blocker. */
export type BlockerResolutionKind = "link" | "execution_device";

/** A blocker vocabulary entry owned by an Agent Template. */
export type AgentBlocker = {
  code: string;
  label: string;
  resolutionKind: BlockerResolutionKind;
};

/**
 * The source registry a Template-declared Agent Skill is installed from.
 * MVP supports ClawHub only (issue #222).
 */
export type AgentSkillSource = "clawhub";

/**
 * OpenClaw agent settings a Template declares (issue #657). Applied to the
 * Agent's `agents.entries.<id>.tools` config when it is registered.
 */
export type OpenClawProfile = {
  /** OpenClaw tool names the Agent is forbidden to call. */
  toolDeny?: string[];
  /** Name of the OpenClaw node the Agent's exec tool runs on (host "node"). */
  execNode?: string;
};

/**
 * Software the user must install on their own machine for the Agent to work
 * (issue #662), e.g. the Android CLI. Never gates activation. Shown in the
 * installation plan; when `install` is declared, the user can install it on
 * the paired machine after explicit consent (#726).
 */
export type MachineExternalPrerequisite = {
  name: string;
  /** http(s) link to the installation instructions. */
  instructionsUrl: string;
};

export type MachinePrerequisite = {
  name: string;
  /** Minimum version the Agent needs, free text (e.g. "1.0"). */
  minVersion?: string;
  /** http(s) link to the installation instructions. */
  instructionsUrl: string;
  /**
   * Exact command that installs the Tool, an npm global install
   * (e.g. `npm install -g @acme/some-tool`). Displayed with a copy button,
   * never run by OpenGroow (#736).
   */
  installCommand?: string;
  /** Programs npm does not cover (Python, `adb`), each with an instructions link (#736). */
  externalPrerequisites?: MachineExternalPrerequisite[];
  /**
   * How OpenGroow installs the tool on the user's own machine, after explicit
   * consent (#726). Absent = the link above is all there is.
   */
  install?: MachineToolInstall;
};

/**
 * A Template's declarative run-context block (issue #659): the section
 * appended to a Run's `context.md`. See `run-context.ts` for the reference
 * grammar; interpolation is bounded text substitution, never code evaluation.
 */
export type RunContextDeclaration = {
  /** Section title, rendered as a `##` heading. */
  heading: string;
  /** One list item each; `{reference}` tokens are substituted. A line whose config/payload reference has no value is omitted. */
  lines: string[];
};

/**
 * A required OpenClaw Agent Skill declared by an Agent Template's manifest.
 * OpenGroow installs this skill into the Agent's workspace during activation
 * and refresh (issue #222). `spec` is the ClawHub skill ref (e.g. an
 * "@owner/slug" style reference) passed verbatim to `clawhub install`.
 */
export type TemplateSkillDeclaration = {
  source: AgentSkillSource;
  spec: string;
  /**
   * Exact ClawHub version the Template author vetted. Native Claw packages
   * require it on every skill (`packages[].version`); the adapter fills it.
   * Optional on the manifest so a Template without it stays valid. Recorded
   * only: the install command does not pin it yet.
   */
  version?: string;
};

/**
 * A Source the Template can produce (issue #528). `family` is free text, not a
 * global enum. `analysisSchema` is a JSON Schema restricted to a strict
 * keyword allow-list (see `findUnsupportedSchemaKeyword`).
 */
export type SourceDeclaration = {
  /** Source type, unique in the Template; the `sourceId` written by the Agent is this value. */
  type: string;
  label: string;
  family: string;
  /** Safe relative .md path, materialized in the workspace like `MissionType.agentsMd`. */
  agentsMd: string;
  analysisSchema: Record<string, unknown>;
};

/** Job capabilities are open-ended. Platform code gives special handling to
 * known types, but an Agent Template may declare its own recurring Job type
 * without requiring a Convex schema release. */
export type JobTypeName = string;

/** An executable, recurring capability declared by an Agent Template. */
export type JobTypeDeclaration = {
  type: JobTypeName;
  /** Required for Jobs that need dedicated instructions; ingestion reuses Source instructions. */
  agentsMd?: string;
  /** Source declarations handled by the source_ingestion Job. */
  sourceTypes?: string[];
};

export type AgentManifest = {
  id: string;
  name: string;
  description: string;
  category: string;
  mcpServers: McpServerConfig[];
  /**
   * Declarative context providers every Mission type of this Template opts
   * into. Each name maps to a registered provider that renders an extra
   * `context.md` section. The dispatcher calls each provider and appends its
   * section to what `buildMissionContext` already produces — no per-Template
   * branch needed. Ignored for a Mission type that declares its own
   * `contextProviders` (see `MissionType`) — use the Template-level list only
   * when every Mission type of this Template genuinely needs the same
   * providers (e.g. Strategy's single Mission type).
   */
  contextProviders?: string[];
  requirements?: RequirementField[];
  /**
   * OpenClaw Agent Skills required by this Template. OpenGroow installs each
   * declared skill into the Agent's workspace during activation and refresh,
   * and mirrors their latest-known state on `projectAgents.skills[]` with
   * `origin: "template"`. Required skills are part of the Agent contract:
   * if one cannot be installed, the Agent is not presented as operational.
   */
  skills?: TemplateSkillDeclaration[];
  /**
   * OpenClaw settings applied when OpenGroow registers the Agent in the
   * Instance. Absent = OpenClaw defaults (no tool restriction, no exec node).
   */
  openclawProfile?: OpenClawProfile;
  /** Machine-side prerequisites shown in the installation plan, never enforced; installable on request (#662, #726). */
  machinePrerequisites?: MachinePrerequisite[];
  /**
   * Runtime context rendered into every Run's `context.md` after the Mission
   * section (issue #659). Absent = the Template adds none.
   */
  runContext?: RunContextDeclaration;
  visibility?: "production" | "development";
  /**
   * Selectable mission types declared by this Template.
   * The dashboard renders these as a <select> in the Create Mission and
   * Create Schedule forms. Each option carries a default payload that
   * pre-fills the payload field when selected.
   * Templates without this field fall back to a free-text type input.
   */
  missionTypes?: MissionType[];
  /**
   * Named exclusive resources (issue #656), each mapped to the Mission types
   * of this Template that use it (e.g. `{ "paired-phone": ["engage"] }`).
   * The dispatcher never runs two Runs that share a resource at the same
   * time — across Instances and across Templates declaring the same name.
   * Mission types that do not list a resource are unaffected by it.
   */
  exclusiveResources?: Record<string, string[]>;
  /**
   * External Job polling contracts, keyed by Mission type and then by job
   * type (the MCP tool name the Agent called). Required for Templates where
   * the Agent hands off a long-running job (writes `status: "in_progress"`
   * with a job pointer and stops). Polling uses MCP tool calls declared by
   * the Template — OpenGroow owns this loop, not the Agent (ADR-020, ADR-026).
   *
   * Uniform shape across all Templates (ADR-026): every Mission type is a map
   * of job type to contract, even Mission types with only one job today. This
   * lets a Mission type declare more than one distinct async job (e.g. an
   * intermediate job followed by a terminal one) without the resolver having
   * to branch on "is this contract scalar or a map."
   */
  externalJobsByMissionType?: Record<string, Record<string, ExternalJobPollingContract>>;
  /**
   * Sources this Template can produce (issue #528, ADR-051). Independent of
   * Mission types: a Mission never knows about Sources. Each declaration's
   * instruction file is materialized in the Agent's workspace at Activation
   * and refresh.
   */
  sources?: SourceDeclaration[];
  /** Explicit recurring Job capabilities provisioned for this Template. */
  jobTypes?: JobTypeDeclaration[];
  /**
   * Optional asynchronous enrichment per Source, keyed by Source id then job
   * type (the MCP tool name). Uses only the shared polling core — no Mission
   * completion fields. Every key must be a declared Source id.
   */
  externalJobsBySource?: Record<string, Record<string, SourceExternalJobPollingContract>>;
  /**
   * Declares, per Mission type, the name of the MCP tool that produces this
   * Mission type's deliverable content (ADR-050). Purely a display switch for
   * the dashboard's "Génération" prompt panel — it does not assert that the
   * tool's output actually contains a usable prompt, only that a human should
   * look. A Mission type with no generative MCP call (e.g. Social Engagement's
   * `engage`) omits its entry and gets no panel.
   */
  generativeMcpCall?: Record<string, { toolName: string }>;
  /**
   * Declarative activation effect (ADR-021): HTTP call to provision the
   * external resource (e.g. POST /projects). OpenGroow executes this
   * generically using the activation engine — no per-template TypeScript needed.
   * When present, OpenGroow skips re-activation if the derived id key
   * (the key whose body-tree leaf is `{responseId}`) is already set in config.
   */
  activation?: ActivationEffect;
  /**
   * Declarative reconfiguration effect (ADR-021): HTTP call to update
   * the mutable part of an already-provisioned external resource
   * (e.g. PATCH /projects/:id). Executed generically by OpenGroow.
   */
  reconfiguration?: ActivationEffect;
  /**
   * When true, the template supports config-only reconfiguration (no external
   * MCP server call). Use for templates that store config purely in Convex and
   * have no external resource to update (e.g. social-engagement).
   */
  reconfigurable?: true;
  /**
   * Declarative Config Completeness status-check (issue #320, ADR-034): gates
   * Activation on the MCP reporting the Project as fully configured on its
   * own side, in place of an `activation` HTTP effect. Mutually exclusive
   * with `activation` in practice and in the engine (`project_agents_node.ts`
   * branches on whichever is present, `statusCheck` taking precedence) — no
   * Template combines both today. When declared, OpenGroow calls this MCP
   * tool with the submitted/frozen `apiKey` and only reaches `active` when
   * the response reports `configured: true` — otherwise the Agent is left in
   * `error` with the MCP's own `message`/`dashboardUrl`.
   */
  statusCheck?: StatusCheckContract;
};

type BaseLeafRequirementField = {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
  /**
   * Frozen at activation: part of the Agent's "frozen config" (identity of the
   * Agent and the external resources it provisioned). Such a field cannot be
   * changed by Reconfiguration; the UI renders it read-only when editing.
   */
  immutable?: boolean;
  /**
   * Its value is pushed to the Instance at activation and at reconfiguration
   * (it is the Agent's credential channel on the Instance). OpenGroow delivers
   * it without knowing which Template declared it; a failed delivery is the
   * Agent's activation error. At most one requirement per manifest.
   */
  deliveredToInstance?: boolean;
};

export type SelectRequirementOption = {
  value: string;
  label: string;
};

export type LeafRequirementField =
  | (BaseLeafRequirementField & {
      type: "text" | "password" | "url" | "textarea";
    })
  | (BaseLeafRequirementField & {
      type: "select";
      options: SelectRequirementOption[];
    });

export type RequirementField =
  | LeafRequirementField
  | { type: "group"; label: string; fields: LeafRequirementField[] };

export type McpClient = {
  baseUrl: string;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
};

/**
 * A leaf value in an ActivationEffect body template.
 * Strings may contain `{key}` or `{config.key}` interpolation references.
 */
export type ActivationBodyNode = string | number | boolean | null | { [key: string]: ActivationBodyNode };

/**
 * A declarative HTTP effect for agent activation or reconfiguration (ADR-021).
 * OpenGroow interprets and executes these effects generically.
 *
 * Interpolation references supported in `path` and `body`:
 *   - `{key}`          → userConfig[key]
 *   - `{config.key}`   → existingConfig[key] (e.g. frozen ids like seoProjectId)
 *   - `{responseId}`   → id extracted from the activation response via `responseIdField`
 *
 * The id key is DERIVED, not declared: whichever key in the persisted-config body
 * tree holds a `{responseId}` leaf becomes the frozen id key (ADR-021, point 3).
 * The reconfigure `path` references this derived key via `{config.<key>}`.
 */
export type ActivationEffect = {
  /** MCP server name (from `mcpServers`) whose activationUrl is used as the base. */
  server: string;
  method: "POST" | "PATCH";
  /** Path relative to the server origin. Supports `{config.key}` interpolation. */
  path: string;
  /** JSON body template. Leaf strings support `{key}`, `{config.key}`, and `{responseId}` interpolation. */
  body?: ActivationBodyNode;
  /** Dotted path in the response JSON that holds the provisioned resource id. E.g. "seoProjectId" or "project.id". */
  responseIdField: string;
  /** When true, a 409 response is treated as "already exists" and parsed normally. */
  treatConflictAsExisting?: boolean;
};

/**
 * Declarative Config Completeness status-check contract (issue #320, ADR-034).
 * Replaces `activation`/`reconfiguration` for Templates whose MCP owns the
 * Project's configuration end-to-end (e.g. an article MCP or a video MCP once they
 * migrate their per-Project config to their own dashboards): OpenGroow only
 * stores the `apiKey`, and asks the MCP — via this read-only tool call —
 * whether the Project it identifies is fully configured on its own side.
 *
 * The tool is called with no arguments; the frozen config's `apiKey` is sent
 * only as the `Authorization: Bearer` header. Its response contract is fixed
 * and MCP-owned (see `ConfigCompletenessStatus`) — OpenGroow never derives its
 * own message from per-provider field names.
 */
export type StatusCheckContract = {
  /** The MCP server name (from `mcpServers`) to call. */
  server: string;
  /** The MCP tool name to call to check Config Completeness. */
  mcpTool: string;
};

/**
 * The fixed, MCP-owned response contract for a `StatusCheckContract` call
 * (issue #320, ADR-034). `message`/`dashboardUrl` are only meaningful when
 * `configured` is `false` — OpenGroow renders them verbatim, never inferring
 * its own copy from provider-specific field names.
 */
export type ConfigCompletenessStatus = {
  configured: boolean;
  dashboardUrl: string;
  message?: string;
};

/**
 * An OpenClaw plugin shipped inside a Template package (`plugins/<id>/`, issue
 * #661). OpenGroow never executes it: reconciliation copies its files into the
 * Instance, where OpenClaw loads it. `files` are relative to the plugin's own
 * folder, sorted by path.
 */
export type TemplatePlugin = {
  id: string;
  files: Array<{ path: string; content: string }>;
};

export type AgentTemplate = {
  manifest: AgentManifest;
  agentsMd: string;
  /**
   * OpenClaw plugins this Template installs into the Instance. Not a manifest
   * key: they come from the package's `plugins/` folder, and the manifest
   * stays the OpenGroow profile.
   */
  plugins?: TemplatePlugin[];
  /**
   * Per-mission instruction files, keyed by mission type. Populated by
   * codegen from `missionTypes[].agentsMd` entries in the manifest.
   * The dispatcher composes the base `agentsMd` with the relevant
   * per-mission file at dispatch time.
   */
  missionAgentsMd?: Record<string, string>;
  /**
   * Per-Source instruction files, keyed by Source id. Populated by codegen
   * from `sources[].agentsMd` entries in the manifest.
   */
  sourceInstructions?: Record<string, string>;
  /** Per-Job instruction files, keyed by Job type. */
  jobInstructions?: Record<string, string>;
};
