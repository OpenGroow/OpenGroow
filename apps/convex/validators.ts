import { v } from "convex/values";

export const instanceJobStatusV = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed")
);

export const runtimeStatusV = v.union(
  v.literal("provisioning"),
  v.literal("starting"),
  v.literal("created"),
  v.literal("linked"),
  v.literal("failed")
);

export const commandStatusV = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed")
);

/** Where an installed Template came from (PRD #642). A local folder (copied or linked) and a Git release (#667) are installable today. */
export const templateOriginV = v.union(
  v.literal("local_folder"),
  v.literal("linked_folder"),
  v.literal("git"),
  v.literal("hub"),
);

/** The Git release a Template was installed from; `archiveDigest` is the verified sha256 of the release archive (#667); `asset` is the release `*.tgz` it came from, when not the tag archive (#672). */
export const gitOriginV = v.object({
  repository: v.string(),
  tag: v.string(),
  asset: v.optional(v.string()),
  archiveDigest: v.string(),
});

export const projectAgentStatusV = v.union(
  v.literal("activating"),
  v.literal("active"),
  v.literal("inactive"),
  v.literal("error")
);

export const missionStatusV = v.union(
  v.literal("todo"),
  v.literal("doing"),
  // The Mission's Run terminated with `blocked_external`: a Template-declared
  // human-action blocker outside OpenGroow (e.g. an MCP dashboard or execution
  // device). Not a failure and not something OpenGroow's review page resolves —
  // exits only via manual retry (issue #323).
  v.literal("blocked"),
  v.literal("to_validate"),
  v.literal("approved"),
  v.literal("done"),
  v.literal("failed"),
  // The operator stopped the Mission via the dashboard's Stop action (issue
  // #482) — an operator-initiated interrupt, distinct from `failed` (an
  // agent/infra error).
  v.literal("cancelled")
);

export const runStatusV = v.union(
  v.literal("pending"),
  v.literal("dispatching"),
  v.literal("running"),
  // The agent dispatched a long-running MCP job and exited; OpenGroow polls the
  // job's status on its ticks until it reaches a terminal state (issue #138).
  v.literal("awaiting_job"),
  v.literal("completed"),
  // An Intermediate External Job (ADR-026) completed: no terminal RunResult
  // was produced. Instead the Mission was resumed with a new `pending` Run.
  // Distinct from `completed`/`failed` so this Run is never re-polled and
  // never mistaken for a terminal result.
  v.literal("resumed"),
  v.literal("failed"),
  // The operator stopped the Mission via the dashboard's Stop action (issue
  // #482) — an operator-initiated interrupt, distinct from `failed`.
  v.literal("cancelled")
);

export const scheduleStatusV = v.union(
  v.literal("active"),
  v.literal("paused")
);

export const sourceJobStateV = v.union(v.literal("active"), v.literal("paused"));

export const sourceJobOutcomeV = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("skipped"),
);

// Job capabilities are open-ended. Specialized executors match the initial
// platform types, while Agent-defined types remain representable in storage.
export const jobTypeV = v.string();

export const jobStateV = v.union(v.literal("active"), v.literal("paused"));

export const jobOutcomeV = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("skipped"),
);

export const scheduleUnitV = v.union(
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly")
);

// Agent Skills (issue #222): a skill is an OpenClaw skill installed inside an
// Agent's workspace. MVP source support is ClawHub only.
export const agentSkillSourceV = v.union(v.literal("clawhub"));

export const agentSkillOriginV = v.union(v.literal("template"), v.literal("user"));

export const agentSkillStatusV = v.union(v.literal("installed"), v.literal("error"));

// Latest-known-state mirror of an installed Agent Skill, persisted on
// projectAgents.skills[] (issue #222).
export const projectAgentSkillV = v.object({
  source: agentSkillSourceV,
  spec: v.string(),
  origin: agentSkillOriginV,
  status: agentSkillStatusV,
  updatedAt: v.number(),
  version: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
});
