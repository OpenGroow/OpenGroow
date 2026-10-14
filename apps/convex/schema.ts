import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  commandStatusV,
  jobOutcomeV,
  jobStateV,
  jobTypeV,
  instanceJobStatusV,
  missionStatusV,
  projectAgentSkillV,
  projectAgentStatusV,
  runStatusV,
  templateOriginV,
  gitOriginV,
  runtimeStatusV,
  scheduleStatusV,
  scheduleUnitV,
} from "./validators.js";
import { artifactV, runResultV } from "./run_result.js";
import { indexingOutcomeV } from "./indexing.js";
import { reconcileDecisionLogV } from "./mission_dispatcher/decision_log.js";
import { sourceMarketingV, sourceStatusV } from "./source_schema.js";
import { sourceJobOutcomeV, sourceJobStateV } from "./validators.js";

// Job/provisioning metadata produced by the remote control-plane
// InstanceProvisioner (docs/CONTROL_PLANE.md). `jobId` remains the table's
// primary identity regardless of provisioner — the local provisioner
// (issue #262) populates it too, with a synthetic id — but the rest of this
// group only makes sense for the async, server-backed job model. All the
// network/server fields are optional and opaque to the product. Stored field
// names are stable: renaming them would require a data migration.
// See ADR-028 (docs/adr/028-instanceprovisioner-seam-for-oss-single-project-self.md).
const controlPlaneInstanceProvisioningFields = {
  // The Project this Instance runs (#724, ADR-066). Always set.
  projectId: v.id("projects"),
  jobId: v.string(),
  status: instanceJobStatusV,
  error: v.optional(v.string()),
  createdAt: v.string(),
  startedAt: v.optional(v.string()),
  finishedAt: v.optional(v.string()),
  networkId: v.optional(v.number()),
  networkName: v.optional(v.string()),
  brokerServerId: v.optional(v.number()),
  brokerPrivateIp: v.optional(v.string()),
  openclawServerId: v.optional(v.number()),
  openclawName: v.optional(v.string()),
  openclawId: v.optional(v.string()),
  openclawKeyId: v.optional(v.string()),
  openclawGatewayToken: v.optional(v.string()),
  openclawVersion: v.optional(v.string()),
  openclawVersionUpdatedAt: v.optional(v.string()),
};

// Runtime/business state shared by every deployment mode (remote control-plane or local
// self-host) — none of it depends on how the Instance was provisioned.
const genericInstanceRuntimeFields = {
  runtimeStatus: v.optional(runtimeStatusV),
  runtimeReady: v.optional(v.boolean()),
  runtimeStatusUpdatedAt: v.optional(v.string()),
  runtimeStatusError: v.optional(v.string()),
  whatsAppChannel: v.optional(
    v.object({
      linked: v.boolean(),
      connected: v.boolean(),
      phoneNumber: v.optional(v.string()),
      configSyncedAt: v.optional(v.string()),
      // Manual kill switch (dashboard "Disable" action) — distinct from
      // linked/connected, which reflect OpenClaw's own channel state.
      enabled: v.optional(v.boolean()),
      // Consecutive failed link probes (issue #493 watchdog) — reset to 0
      // the moment a probe reports linked:true, never persisted across an
      // explicit reconfiguration of the phone number.
      linkFailureCount: v.optional(v.number()),
      // Set when the watchdog itself flips `enabled` to false, so the
      // dashboard can explain an unexpected disable instead of looking like
      // a manual action nobody remembers taking.
      autoDisabledReason: v.optional(v.string()),
      updatedAt: v.string()
    })
  ),
  telegramChannel: v.optional(
    v.object({
      configured: v.boolean(),
      updatedAt: v.string()
    })
  ),
  // A "Provider" (see GLOSSARY.md) is an AI model route configured for this
  // Instance — either a linked OAuth subscription or a direct API key.
  // Replaces the earlier separate authProvider/aiConfigs fields (#280):
  // those tracked "linked"/"configured" independently per auth kind, which
  // could disagree about which provider the agent actually calls. Here,
  // exactly one entry has inUse: true, enforced by the mutations that write
  // this array, never by convention alone.
  providers: v.optional(
    v.array(
      v.object({
        kind: v.union(v.literal("subscription"), v.literal("apikey")),
        // OpenClaw's own canonical provider id ("openai", "anthropic",
        // "xiaomi"...) — see docs/concepts/oauth.md. Two entries may share a
        // provider id (e.g. an "openai" apikey and an "openai" subscription
        // configured at once); (provider, kind) is the unique key.
        provider: v.string(),
        model: v.string(),
        baseUrl: v.optional(v.string()),
        inUse: v.boolean(),
        updatedAt: v.string()
      })
    )
  ),
  speechToText: v.optional(
    v.object({
      provider: v.string(),
      enabled: v.boolean(),
      updatedAt: v.string()
    })
  ),
  workspaceList: v.optional(
    v.object({
      workspaces: v.array(
        v.object({
          workspaceKey: v.string(),
          label: v.string(),
          absolutePath: v.string(),
          isActive: v.boolean(),
          kind: v.string(),
          availableFiles: v.array(
            v.object({
              filePath: v.string(),
              title: v.string(),
              kind: v.string(),
            })
          ),
        })
      ),
      updatedAt: v.string(),
    })
  ),
  ipv4: v.optional(v.string()),
  updatedAt: v.string(),
};

const runSharedFields = {
  // Set on the execution a SourceJob resumes after an enrichment (issue
  // #533): the awaiting Run whose `intermediateResult` (the external job's
  // output, or its failure) it receives in context.md.
  resumedFromRunId: v.optional(v.id("runs")),
  ownerId: v.string(),
  instanceId: v.string(),
  templateId: v.string(),
  agentName: v.string(),
  sessionKey: v.string(),
  humanFeedback: v.optional(v.string()),
  status: runStatusV,
  dispatchedAt: v.optional(v.number()),
  dispatchCommandId: v.optional(v.id("commands")),
  resultReadCommandId: v.optional(v.id("commands")),
  // Set once a last-chance workspace read has been dispatched after the
  // salvage-read grace period elapsed on a stale not-found (see
  // ReconcileSnapshot.finalReadCommandId in mission_dispatcher/reconciliation.ts).
  finalReadCommandId: v.optional(v.id("commands")),
  // Set when the agent hands back a pointer to a long-running MCP job
  // (status `awaiting_job`); OpenGroow polls this job until terminal (#138).
  // `summary`/`reviewQuestions` are the human-facing copy the agent intended
  // for the eventual needs_human_review result, promoted on job completion.
  mcpJob: v.optional(
    v.object({
      serverName: v.string(),
      jobId: v.string(),
      summary: v.string(),
      reviewQuestions: v.array(v.string()),
      // The MCP tool name the Agent called (ADR-026), forwarded from the
      // in_progress RunResult's `job.jobType`. Optional only for legacy Runs
      // written before this field existed (pre-#243); every Run written
      // going forward always has it, since run_result.ts's zod schema still
      // requires `job.jobType` on the in_progress handoff shape.
      jobType: v.optional(v.string()),
      missionType: v.optional(v.string()),
      // SourceJob execution only (issue #533): the `sources` row this job
      // enriches, as the Agent reported it. Agent-supplied, so resolved and
      // ownership-checked at poll time rather than typed as an id here.
      sourceRef: v.optional(v.string()),
    }),
  ),
  completedAt: v.optional(v.number()),
  result: v.optional(runResultV),
  errorMessage: v.optional(v.string()),
  // Set by `markResumed` (ADR-026) on the Run whose Intermediate External
  // Job just resolved — the terminal snapshot of *this* Run's own job,
  // distinct from `mission.lastIntermediateResult`/`lastRetryableFailure`
  // (which only ever hold the most recent one, unlinked to a specific Run).
  // Lets the dashboard show why each individual "resumed" Run resumed,
  // not just the latest. `{ jobType, output }` on a resumption, or
  // `{ jobType, error, details }` on a retryable failure — same shapes as
  // the Mission-level fields above, just also kept per-Run.
  intermediateResult: v.optional(v.any()),
  // Read-only audit snapshot of what this Run actually received at dispatch
  // (ADR-050, amends ADR-018): `AGENTS.md`/`context.md` are rebuilt fresh at
  // every dispatch and never otherwise persisted, so nothing keeps a durable
  // copy of what a given Run was given. Written once by `markRunning`, never
  // synced or re-derived — a Run's snapshot reflects the Brand Core/Template
  // instructions as they were at that Run's dispatch, which will diverge
  // from the live Brand Core/`AGENTS.md` over time by design.
  agentsMdSnapshot: v.optional(v.string()),
  contextMdSnapshot: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export default defineSchema({
  commands: defineTable({
    instanceId: v.string(),
    type: v.string(),
    payload: v.any(),
    status: commandStatusV,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    ackedAt: v.optional(v.number()),
    createdAt: v.number(),
    deferred: v.optional(v.boolean()),
  })
    .index("by_instance_status", ["instanceId", "status"])
    // Coalescing reads only the *dispatchable* queue (deferred === false), so
    // `deferred` belongs in the index rather than in a post-scan `.filter()`:
    // during a Broker outage the deferred backlog can grow without bound and
    // a filtered scan would read every one of those documents.
    .index("by_instance_and_status_and_deferred", ["instanceId", "status", "deferred"]),
  commandResults: defineTable({
    instanceId: v.string(),
    commandId: v.id("commands"),
    type: v.string(),
    payload: v.any(),
    ts: v.number(),
    createdAt: v.number(),
  })
    .index("by_instance_and_command", ["instanceId", "commandId"]),
  events: defineTable({
    instanceId: v.string(),
    eventId: v.string(),
    type: v.string(),
    payload: v.any(),
    ts: v.number(),
    createdAt: v.number()
  })
    .index("by_instance_created", ["instanceId", "createdAt"])
    .index("by_instance_event", ["instanceId", "eventId"])
    .index("by_created_at", ["createdAt"]),
  // The Project as its own entity (#724, ADR-066). `_id` is the stable identity
  // from the first moment; `projectId` is the string identifier the other tables
  // store (`instanceId`, `installedTemplates.projectId`): the Instance's
  // `openclawId`, copied unchanged by the backfill so no other table is
  // rewritten. Absent only while a remote Instance is still provisioning; set
  // once, never changed (re-provisioning does not move it).
  projects: defineTable({
    projectId: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    displayName: v.optional(v.string()),
    // Per-Project settings (and, for the cloud, quotas / subscription). Free-form
    // for now; nothing reads it yet.
    settings: v.optional(v.record(v.string(), v.any())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_id", ["projectId"])
    .index("by_owner_id", ["ownerId"]),
  instances: defineTable({
    ...controlPlaneInstanceProvisioningFields,
    ...genericInstanceRuntimeFields,
  })
    .index("by_job_id", ["jobId"])
    .index("by_openclaw_id", ["openclawId"])
    .index("by_updated_at", ["updatedAt"])
    .index("by_project", ["projectId"])
    .index("by_whatsapp_channel_linked", ["whatsAppChannel.linked"]),
  projectAgents: defineTable({
    instanceId: v.string(),
    templateId: v.string(),
    workspaceKey: v.optional(v.string()),
    openclawAgentName: v.optional(v.string()),
    status: projectAgentStatusV,
    errorMessage: v.optional(v.string()),
    // Config Completeness (issue #320, ADR-034): when a statusCheck-gated
    // Activation reports `configured: false`, carries the MCP's own
    // `dashboardUrl` so the dashboard can render it as a real link instead
    // of parsing it out of free text. Only meaningful alongside errorMessage.
    errorLink: v.optional(v.string()),
    mcpServerKeys: v.array(v.string()),
    config: v.optional(v.record(v.string(), v.any())),
    // Mission types the operator hides from this Agent's creation forms and
    // workspace (ADR-053). A deny-list: absent or empty hides nothing.
    hiddenMissionTypes: v.optional(v.array(v.string())),
    // Latest-known-state mirror of installed Agent Skills (issue #222). Bounded
    // by the small number of skills a Template can declare — not an unbounded list.
    skills: v.optional(v.array(projectAgentSkillV)),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Set once the #601 migration has queued removal of instruction files and
    // top-level legacy Run artifacts from this managed workspace.
    legacyWorkspaceCleanupAt: v.optional(v.number()),
    // Cursor for the paginated #601 cleanup; absent means the first page.
    legacyWorkspaceCleanupCursor: v.optional(v.string()),
  })
    .index("by_instance_template", ["instanceId", "templateId"])
    .index("by_instance_status", ["instanceId", "status"])
    .index("by_template_status", ["templateId", "status"]),
  // Per-Project Template registry (#650, ADR-054). A Project is identified by
  // its Instance id (`instances.openclawId`): there is no Project table, and
  // the registry is keyed by that id. Several versions of a Template coexist;
  // exactly one per (project, template) is `current`. Files live in
  // `templateFiles`, one document each, to stay well under Convex's
  // per-document size limit.
  installedTemplates: defineTable({
    projectId: v.string(),
    templateId: v.string(),
    version: v.string(),
    origin: templateOriginV,
    // Where a Git-installed Template (origin "git") was downloaded from (#667).
    gitOrigin: v.optional(gitOriginV),
    // "sha256:<hex>" over the package files.
    digest: v.string(),
    // The validated manifest, so listings never need the files.
    manifest: v.any(),
    current: v.boolean(),
    // A newer version offered to the Project and not applied yet (#669): never
    // current, never resolved by default; applying it makes it current. At most
    // one per (project, template).
    staged: v.optional(v.boolean()),
    installedAt: v.number(),
    installedBy: v.optional(v.string()),
  })
    .index("by_project_template", ["projectId", "templateId"])
    .index("by_project_template_version", ["projectId", "templateId", "version"])
    .index("by_project_current_template", ["projectId", "current", "templateId"])
    .index("by_project_staged", ["projectId", "staged"])
    .index("by_project_template_staged", ["projectId", "templateId", "staged"]),
  // Self-host only (#654): the operator's URL for one MCP server of an
  // installed Template. Keyed by (project, template, server name), not by
  // version, so it survives a Template update while the server still exists.
  templateMcpUrlOverrides: defineTable({
    projectId: v.string(),
    templateId: v.string(),
    serverName: v.string(),
    url: v.string(),
  }).index("by_project_template", ["projectId", "templateId", "serverName"]),
  templateFiles: defineTable({
    installedTemplateId: v.id("installedTemplates"),
    path: v.string(),
    content: v.string(),
  }).index("by_installed_template", ["installedTemplateId"]),
  brandCores: defineTable({
    instanceId: v.string(),
    audience: v.optional(v.string()),
    tone: v.optional(v.string()),
    offer: v.optional(v.string()),
    positioning: v.optional(v.string()),
    editorialRules: v.optional(v.string()),
    constraints: v.optional(v.string()),
    avoid: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"]),
  missions: defineTable({
    ownerId: v.string(),
    instanceId: v.string(),
    templateId: v.string(),
    // The Template version the Mission was created with (#651): absent
    // when the Template was not installed at creation, and on Missions created
    // before pinning: those
    // follow the Project's current version. The review engine and external job
    // polling resolve the Template at this version.
    templateVersion: v.optional(v.string()),
    type: v.string(),
    payload: v.any(),
    status: missionStatusV,
    // Cancellation-in-progress gate (issue #482): set true by
    // `missions_node.cancelMission` *before* it dispatches the gateway kill
    // command and awaits the (multi-second) runtime event, so a concurrent
    // `resumeMission`/`resumeMissionAfterRetryableFailure` landing during that
    // wait window is rejected instead of racing ahead of `runs.markCancelled`
    // and dispatching a superseded Run. Cleared once `runs.markCancelled`
    // finalizes the Mission to the terminal `cancelled` status.
    cancelling: v.optional(v.boolean()),
    number: v.optional(v.number()),
    name: v.optional(v.string()),
    summary: v.optional(v.string()),
    // Set for Missions created automatically from a Source's production
    // pipeline. Kept optional for Missions created before this provenance
    // marker existed and for manually-created Missions.
    sourceObservationId: v.optional(v.id("sources")),
    // Opt-in to auto-chaining "approve" then "publish" once the Run reaches
    // `needs_human_review`, skipping the manual review step (issue #328,
    // PRD #326). Only meaningful for Templates whose review contract supports
    // the full to_validate -> approved flow — see
    // `templateSupportsAutoPublish` in `@opengroow/agent-templates`. Settable
    // at creation and toggleable via `setAutoPublish` while status is
    // `todo`/`doing`; the actual auto-chaining trigger is issue #329.
    autoPublish: v.optional(v.boolean()),
    lastResult: v.optional(runResultV),
    lastArtifact: v.optional(artifactV),
    // Non-terminal value produced by an Intermediate External Job's
    // completion (ADR-026): `{ jobType, output }`. Replaced (never
    // accumulated) on each resumption; injected into the next Run's
    // context.md, distinct from the terminal lastResult/lastArtifact.
    lastIntermediateResult: v.optional(v.any()),
    // How many times a retryable External Job failure (`onFail: "resume_mission"`,
    // ADR-026 extension) has resumed this Mission. Incremented by
    // `resumeMissionAfterRetryableFailure`; caps the retry loop at
    // `MAX_RETRYABLE_JOB_FAILURES` (mission_dispatcher/external_job_polling.ts)
    // so an Agent that keeps repeating the same mistake (e.g. an over-length
    // Letter title) cannot loop forever.
    retryableFailureCount: v.optional(v.number()),
    // The most recent retryable External Job failure, surfaced to the Agent
    // via context.md (mission_context.ts) so it can see what went wrong and
    // correct its Manifest on the next Run. Distinct from `lastIntermediateResult`:
    // that field is ADR-026's non-terminal *success* value, this one is an error.
    lastRetryableFailure: v.optional(
      v.object({
        jobType: v.optional(v.string()),
        error: v.string(),
        details: v.optional(v.any()),
      }),
    ),
    errorMessage: v.optional(v.string()),
    // Read-only mirror of the article MCP's indexing outcome, snapshot at publication
    // (ADR-015). Distinct from errorMessage: an indexing failure is not a
    // mission failure.
    indexing: v.optional(indexingOutcomeV),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_instance_template", ["instanceId", "templateId"])
    .index("by_instance_template_version_status", ["instanceId", "templateId", "templateVersion", "status"])
    .index("by_status_updated", ["status", "updatedAt"])
    // Lets "the Agent's Missions, most recently updated first" (Agent Logs
    // page, #231) be an index-ordered `.order("desc").take(n)` scoped to the
    // Workspace's owning Agent, instead of `withIndex` + `.filter` + an
    // unbounded `.collect()` reduced in memory.
    .index("by_instance_template_owner_updated", ["instanceId", "templateId", "ownerId", "updatedAt"])
    // Scopes both `missions.listActiveByInstance` (per-status `.take(n)`) and
    // `missions.listDoneByInstance` (paginated "Done" kanban column) to an
    // index-ordered scan instead of an unbounded per-instance `.collect()`.
    .index("by_instance_status_updated", ["instanceId", "status", "updatedAt"]),
  projectCounters: defineTable({
    instanceId: v.string(),
    missionCount: v.number(),
  })
    .index("by_instance", ["instanceId"]),
  runs: defineTable(
    // A Run is attached to exactly one parent, a Mission or a generic Job.
    // Each shape requires its own id and only admits `null` (never an id) for
    // the other one, so `run.missionId` / `run.jobId` stay indexable (an absent
    // field is undefined in the index). Convex has no "never" validator;
    // `v.null()` is the closest, and readers treat null like absent.
    v.union(
      v.object({
        missionId: v.id("missions"),
        sourceJobId: v.optional(v.null()),
        ...runSharedFields,
      }),
      v.object({
        // Generic Job execution parent (issue #595).
        jobId: v.id("jobs"),
        missionId: v.optional(v.null()),
        sourceJobId: v.optional(v.null()),
        ...runSharedFields,
      }),
    ),
  )
    .index("by_mission", ["missionId"])
    .index("by_job", ["jobId"])
    // Finds the newest live (dispatching/running/awaiting_job) Run for a
    // Mission without collecting its full Run history (issue #482 review):
    // a Mission can accumulate many Runs over its lifetime (ADR-026 resumes,
    // retries), so `runs.findLiveRunForMission` does 3 bounded point lookups
    // (one per live status) via this index instead of an unbounded
    // `by_mission` collect.
    .index("by_mission_status_created", ["missionId", "status", "createdAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_instance_template_status", ["instanceId", "templateId", "status"])
    // Social Engagement agents may run in different OpenClaw instances while
    // targeting the same paired Android node. The dispatcher uses this index
    // for the template-level execution-device lock.
    .index("by_template_status_created", ["templateId", "status", "createdAt"])
    // Lets "the latest Run for this Agent" (Agent Logs page, #231) be a
    // single indexed `.order("desc").first()` instead of collecting every
    // Run for the Agent and reducing in memory.
    .index("by_instance_template_created", ["instanceId", "templateId", "createdAt"])
    // "The Agent's Runs completed after instant T" per terminal status
    // (completed/resumed/failed/cancelled): one bounded range scan per status.
    // Callers keep only Runs with a `missionId` (Runs of Missions).
    .index("by_instance_template_status_completed", ["instanceId", "templateId", "status", "completedAt"])
    .index("by_dispatch_command", ["dispatchCommandId"]),
  jobs: defineTable({
    ownerId: v.string(),
    instanceId: v.string(),
    templateId: v.string(),
    type: jobTypeV,
    state: jobStateV,
    config: v.any(),
    runtime: v.any(),
    unit: scheduleUnitV,
    dayOfWeek: v.optional(v.number()),
    dayOfMonth: v.optional(v.number()),
    hour: v.number(),
    minute: v.number(),
    timezone: v.string(),
    nextRunAt: v.number(),
    lastRunAt: v.optional(v.number()),
    lastOutcome: v.optional(jobOutcomeV),
    lastSummary: v.optional(v.string()),
    lastError: v.optional(v.string()),
    latestRunId: v.optional(v.id("runs")),
    // A top-level indexed claim lets Run Now bypass an arbitrarily large
    // backlog of scheduled rows. The typed runtime still records the
    // type-specific restore/coordination details.
    runNowAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance_type_template", ["instanceId", "type", "templateId"])
    .index("by_instance_template", ["instanceId", "templateId"])
    .index("by_instance_owner", ["instanceId", "ownerId"])
    .index("by_type_state_nextRun", ["type", "state", "nextRunAt"])
    .index("by_type_runNowAt", ["type", "runNowAt"])
    .index("by_state_nextRun", ["state", "nextRunAt"])
    .index("by_runNowAt", ["runNowAt"]),
  schedules: defineTable({
    ownerId: v.string(),
    instanceId: v.string(),
    templateId: v.string(),
    type: v.string(),
    payload: v.any(),
    // Default `autoPublish` propagated to every Mission this Schedule creates
    // (issue #330, PRD #326). Same capability restriction as a manually
    // created Mission — see `templateSupportsAutoPublish` in
    // `@opengroow/agent-templates` — enforced only in the dashboard form; the
    // tick simply copies this value onto `missions.autoPublish` verbatim.
    autoPublish: v.optional(v.boolean()),
    // Structured recurrence.
    unit: scheduleUnitV,
    dayOfWeek: v.optional(v.number()), // 0–6, weekly
    dayOfMonth: v.optional(v.number()), // 1–31, monthly
    hour: v.number(), // 0–23
    minute: v.number(), // 0–59
    timezone: v.string(), // IANA, captured from the browser at creation
    status: scheduleStatusV,
    nextRunAt: v.number(), // ms UTC, pre-computed next due slot
    lastRunAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastMissionId: v.optional(v.id("missions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance_template", ["instanceId", "templateId"])
    .index("by_status_nextRun", ["status", "nextRunAt"]),
  connectTickets: defineTable({
    ticketId: v.string(),
    instanceId: v.string(),
    gatewayToken: v.string(),
    openclawName: v.optional(v.string()),
    ipv4: v.optional(v.string()),
    serverId: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number()
  })
    .index("by_ticket_id", ["ticketId"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_instance_id", ["instanceId", "createdAt"]),
  connectedDevices: defineTable({
    instanceId: v.string(),
    displayName: v.string(),
    connectedAt: v.number(),
    caps: v.array(v.string()),
  })
    .index("by_instance_id", ["instanceId"])
    .index("by_instance_id_and_display_name", ["instanceId", "displayName"]),
  // Append-only decision log for Run reconciliation (issue #237): one row per
  // tick where `decideReconciliation`/`decideExternalJobPoll` applied a
  // decision to a Run, in the order it was applied. A separate table (rather
  // than a `decisions[]` array on `runs`) because this is an unbounded,
  // ever-growing list per Run — the same reasoning that keeps `events` its
  // own table instead of living on `instances`/`commands`. Consecutive `wait`
  // decisions are collapsed to one row (see `mission_dispatcher.recordReconcileDecision`)
  // so a Run parked for a long time doesn't flood the log with no new
  // information.
  runReconcileEvents: defineTable({
    runId: v.id("runs"),
    missionId: v.optional(v.id("missions")),
    decision: reconcileDecisionLogV,
    createdAt: v.number(),
  }).index("by_run_created", ["runId", "createdAt"]),
  // A named, reusable creative pattern for an Instance (issue #486) —
  // resolved by the scoring call at deep-enrichment completion, either by
  // matching an Observation to an existing family (by slug) or by proposing
  // a new one. No table-level relation back to the Observations that
  // produced/matched it; `sources.creativeFamilyId` is the only link.
  creativeFamilies: defineTable({
    instanceId: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.string(),
  })
    // Lists an Instance's existing families for the scoring call's prompt
    // context.
    .index("by_instance", ["instanceId"])
    // Matches (or confirms the absence of) a proposed slug for an Instance —
    // fully index-served lookup, no `.filter()`.
    .index("by_instance_slug", ["instanceId", "slug"]),
  // Sources (issue #529, ADR-051): the generic, append-only successor of
  // Observations, ingested by Convex from a SourceJob Run's result file.
  // `label` and `family` are copied from the Template's declaration, never
  // from the writing Agent.
  // `marketing` and `status` are derived from the single zod definition in
  // `source_schema.ts`; `analysis` is validated against the Template's
  // declared JSON Schema before insertion. No scoring fields yet: OpenGroow
  // computes them, never an Agent.
  sources: defineTable({
    instanceId: v.string(),
    // Only known at write time (from the signing key's registry entry).
    ownerId: v.string(),
    templateId: v.string(),
    // The `type` of the Template's `sources[]` declaration this row was written
    // against — not a foreign key into this table.
    sourceId: v.string(),
    label: v.string(),
    family: v.string(),
    status: sourceStatusV,
    origin: v.string(),
    capturedAt: v.number(),
    createdAt: v.number(),
    marketing: sourceMarketingV,
    // Optional verbatim capture, <= 64 KB (enforced at the route).
    raw: v.optional(v.string()),
    analysis: v.any(),
    // Computed by OpenGroow, never written by an Agent. Retained for validating
    // pre-#601 rows while generic Job reconciliation owns active scoring.
    scoring: v.optional(v.record(v.string(), v.number())),
    // Migration-only claim from the retired score Mission path.
    scoreMissionId: v.optional(v.id("missions")),
    // Single `runId` for two uses: provenance of a new Source (set server side
    // by the SourceJob ingestion from the Run that produced it, absent on a
    // Source inserted by other means) and the inherited Run reference of a
    // Source migrated from an Observation (issue #535). `sourceJobId` is
    // specific to the SourceJob path.
    runId: v.optional(v.id("runs")),
    // Provenance: the generic Job that ingested this Source.
    sourceJobId: v.optional(v.id("jobs")),
    // Set by `sources.retry`: the Source joins the next SourceJob batch
    // regardless of the cursor; cleared when that batch succeeds.
    retryRequested: v.optional(v.boolean()),
    // ─── Legacy Observation columns (issue #535) ─────────────────────────
    // Present on rows migrated from the former `observations` table (and on the fields
    // the scoring/selection/production pipeline still writes). Flagged legacy:
    // they stay on the row, with the same meaning as before, until ADR-051's
    // later lift-out. The numeric rubric/engagement scores live in `scoring`
    // (`productFit`, `replicability`, `creativeStrength`, `rawEngagementScore`,
    // `engagementScore`, `replicationScore`).
    //
    // The id of the (since removed) `observations` row this Source was
    // migrated from. Kept only so existing rows keep validating; nothing reads it.
    legacyObservationId: v.optional(v.string()),
    missionId: v.optional(v.id("missions")),
    // READ-ONLY legacy column, distinct from `raw` above: `rawData` is the
    // complete session report.json of a migrated Observation (inherited, kept
    // as-is); `raw` is the verbatim capture of a new Source ingested
    // from a SourceJob Run's result.
    rawData: v.optional(v.string()),
    enrichedAt: v.optional(v.number()),
    enrichmentAnalyzer: v.optional(v.string()),
    creativeFamilyId: v.optional(v.id("creativeFamilies")),
    // `undefined` is "not excluded" (absent means not excluded).
    excluded: v.optional(v.boolean()),
    selectedAt: v.optional(v.number()),
    producedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    productionMissionId: v.optional(v.id("missions")),
    // Migration-only technical delegation pointer, cleared by #601.
    delegateMissionId: v.optional(v.id("missions")),
    // Ownership (and, for the family filter, the family) is folded into the
    // indexes rather than a post-read `.filter()` (`_generated/ai/guidelines.md`,
    // "Query guidelines"), so a paginated page holds only the caller's rows.
  })
    .index("by_instance_owner_capturedAt", ["instanceId", "ownerId", "capturedAt"])
    // Family-filtered list, and the distinct-family walk of `listFamilies`.
    .index("by_instance_owner_family_capturedAt", ["instanceId", "ownerId", "family", "capturedAt"])
    .index("by_instance_template_retry", ["instanceId", "templateId", "retryRequested"])
    // The Sources of an Agent still waiting on their enrichment (`processing`).
    .index("by_instance_template_status", ["instanceId", "templateId", "status"])
    // The daily scoring job's "ready, within the lookback window" read (#487,
    // #535): the `capturedAt` bound is applied inside the index scan.
    .index("by_instance_status_capturedAt", ["instanceId", "status", "capturedAt"]),
});
