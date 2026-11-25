import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { getTemplateRegistry } from "./template_registry.js";
import { allChannels, projectPublishers } from "./project_publishers.js";
import { CONTEXT_PROVIDER_RENDERERS } from "./mission_dispatcher/context_providers.js";
import { planningPeriodOf, remainingOf } from "@opengroow/protocol/content-planning-pins";
import {
  planningDaysOf,
  productionTargetsOf,
  usableTargets,
  validateContentPlanningConfig,
  type PlanningOptions,
} from "@opengroow/protocol/content-planning-config";

// The `content_planning` Job type (ADR-086, issue #174). A Job of the Strategy
// Agent, not a Mission: its own recurrence and Run Now, no Mission. This module
// owns its configuration (planning horizon and production targets per format),
// the options the Project offers for it, and the pass that decides whether a
// Run can start at all. Skips happen before dispatch and create no Run.

export const CONTENT_PLANNING_JOB_TYPE = "content_planning" as const;
export const NO_TARGETS_SUMMARY = "no production targets configured";
export const DRAFT_EXISTS_SUMMARY = "a draft Content Plan is waiting for review";
export const TARGETS_MET_SUMMARY = "targets already met";

const IN_FLIGHT = new Set(["pending", "dispatching", "running", "awaiting_job"]);
/** Bounds the count of approved contents read for one period. */
const MAX_EXISTING_READ = 500;

/** Everything a Content Planning Run depends on, pinned on the Run when it starts (`run.contentPlanning`). */
export type ContentPlanningPins = NonNullable<Doc<"runs">["contentPlanning"]>;

/** The text a Content Planning Run reads: the pinned period and targets (context provider) and what to do with them. */
export function buildContentPlanningRunFile(pins: ContentPlanningPins): string {
  const section = CONTEXT_PROVIDER_RENDERERS["content-planning-targets"](pins);
  return [
    "# Content Planning",
    "",
    "This session is a Content Planning Job, not a Mission: propose a Content Plan for the period below and return the result described in your Job instructions (jobs/content-planning.md). Nothing here creates a Mission.",
    "",
    section ?? "",
  ].join("\n");
}

/** What a new Job holds: a week horizon and no target. */
export function defaultContentPlanningConfig() {
  return { planningDays: planningDaysOf({}), productionTargets: [] };
}

/**
 * What the Project offers a production target: the formats (`publish.kind`) of the Mission types of its
 * active Agents (a Mission type with no `publish`, or hidden, is left out; no catalogue of our own) and
 * the keys of its Publish targets.
 */
export async function planningOptionsOf(ctx: QueryCtx, instanceId: string): Promise<PlanningOptions> {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "active"))
    .take(100);
  const registry = getTemplateRegistry(ctx);
  const formats = new Set<string>();
  for (const agent of agents) {
    const template = await registry.resolve(instanceId, agent.templateId);
    const hidden = new Set(agent.hiddenMissionTypes ?? []);
    for (const missionType of template?.manifest.missionTypes ?? []) {
      if (!hidden.has(missionType.type) && missionType.publish?.kind) formats.add(missionType.publish.kind);
    }
  }
  const publishTargets = allChannels(await projectPublishers(ctx, instanceId)).map((channel) => channel.target);
  return { formats: [...formats].sort(), publishTargets };
}

/** The options of the Jobs page form. */
export const options = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await ownerIdsFor(ctx, args.instanceId)) === null) return { formats: [], publishTargets: [] };
    return await planningOptionsOf(ctx, args.instanceId);
  },
});

async function loadOwnedJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== CONTENT_PLANNING_JOB_TYPE) throw new Error("Forbidden");
  await requireOwnedRow(ctx, job);
  return job;
}

/** Saves the horizon and the targets; refused with every reason when the validator does not accept them. */
export const setConfig = mutation({
  args: {
    jobId: v.id("jobs"),
    planningDays: v.number(),
    productionTargets: v.array(v.object({ kind: v.string(), quantity: v.number(), publishTargets: v.array(v.string()) })),
  },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const checked = validateContentPlanningConfig(
      { planningDays: args.planningDays, productionTargets: args.productionTargets },
      await planningOptionsOf(ctx, job.instanceId),
    );
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    await ctx.db.patch(job._id, { config: checked.value, updatedAt: Date.now() });
  },
});

type Runtime = Record<string, unknown>;

function runtimeOf(job: Doc<"jobs">): Runtime {
  return job.runtime && typeof job.runtime === "object" && !Array.isArray(job.runtime) ? (job.runtime as Runtime) : {};
}

function frequencyOf(job: Doc<"jobs">): Frequency {
  return {
    unit: job.unit,
    ...(job.dayOfWeek !== undefined ? { dayOfWeek: job.dayOfWeek } : {}),
    ...(job.dayOfMonth !== undefined ? { dayOfMonth: job.dayOfMonth } : {}),
    hour: job.hour,
    minute: job.minute,
  };
}

/** The runtime once the manual claim is consumed. */
function consumedRuntime(job: Doc<"jobs">): Runtime {
  const { runNowRequestedAt: _a, runNowRestorePaused: _b, ...rest } = runtimeOf(job);
  return rest;
}

async function agentIsActive(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  return agent?.status === "active" && agent.workspaceKey !== undefined;
}

/** The summary of a pass that found nothing to plan, with what was ignored since the configuration was saved. */
function skipSummary(base: string, ignored: readonly string[]): string {
  return ignored.length > 0 ? `${base} (ignored: ${ignored.join("; ")})` : base;
}

async function hasRunInFlight(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  const runId = runtimeOf(job).inFlightRunId;
  const run = typeof runId === "string" ? await ctx.db.get(runId as Id<"runs">) : null;
  return run !== null && IN_FLIGHT.has(run.status);
}

/** The Planning period and, per usable format, the target, the approved contents already in the period and the remainder. */
async function pinsFor(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  usable: readonly { kind: string; quantity: number; publishTargets: string[] }[],
  ignored: readonly string[],
  now: number,
): Promise<ContentPlanningPins> {
  const { periodStart, periodEnd } = planningPeriodOf(now, planningDaysOf(job.config));
  // Approved Planned Contents of the period, from any plan; Missions and Publications outside plans never count.
  const approved = await ctx.db
    .query("plannedContents")
    .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", job.instanceId).eq("status", "approved").gte("plannedAt", periodStart).lte("plannedAt", periodEnd))
    .take(MAX_EXISTING_READ);
  return {
    periodStart,
    periodEnd,
    targets: usable.map((entry) => {
      const existing = approved.filter((content) => content.kind === entry.kind).length;
      return { kind: entry.kind, target: entry.quantity, existing, remaining: remainingOf(entry.quantity, existing), publishTargets: entry.publishTargets };
    }),
    ignored: [...ignored],
  };
}

/** Creates the Run holding its pins; the Job's manual claim is consumed and its next run advanced. */
async function startRun(ctx: MutationCtx, job: Doc<"jobs">, pins: ContentPlanningPins, settled: Record<string, unknown>, now: number): Promise<void> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  const runId = await ctx.db.insert("runs", {
    jobId: job._id, ownerId: job.ownerId, instanceId: job.instanceId, templateId: job.templateId,
    agentName: agent?.openclawAgentName ?? job.templateId, sessionKey: "", status: "pending", contentPlanning: pins, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
  await ctx.db.patch(job._id, {
    ...settled, latestRunId: runId, lastRunAt: now, runtime: { ...(settled.runtime as Runtime), inFlightRunId: runId }, lastError: undefined,
  });
}

/** A Content Planning Run failed or was cancelled before a plan was persisted: the Job's execution ends as failed. */
export async function failContentPlanningRun(ctx: MutationCtx, run: Doc<"runs">, jobId: Id<"jobs">, error: string): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== CONTENT_PLANNING_JOB_TYPE || runtimeOf(job).inFlightRunId !== run._id) return;
  const { inFlightRunId: _run, ...rest } = runtimeOf(job);
  await ctx.db.patch(job._id, { runtime: rest, lastOutcome: "failed", lastError: error, updatedAt: Date.now() });
}

export const isContentPlanningRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => (await ctx.db.get(args.runId))?.contentPlanning !== undefined,
});

/** What dispatching a Run needs; the pins come from the Run itself, never recomputed from the Job. */
export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const jobId = (run as (typeof run & { jobId?: Id<"jobs"> }) | null)?.jobId;
    if (!run || !jobId || !run.contentPlanning) return null;
    const job = await ctx.db.get(jobId);
    if (!job || job.type !== CONTENT_PLANNING_JOB_TYPE) return null;
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", run.instanceId).eq("templateId", job.templateId))
      .unique();
    if (!agent?.workspaceKey) return null;
    return {
      run: { _id: run._id, agentName: run.agentName, sessionKey: run.sessionKey },
      workspaceKey: agent.workspaceKey,
      instanceId: run.instanceId,
      templateId: job.templateId,
      jobId: job._id,
      pins: run.contentPlanning,
    };
  },
});

/** Starts the due passes: scheduled ones of active Jobs and queued Run Now requests. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [activeDue, manualDue] = await Promise.all([
      ctx.db.query("jobs").withIndex("by_type_state_nextRun", (q) => q.eq("type", CONTENT_PLANNING_JOB_TYPE).eq("state", "active").lte("nextRunAt", now)).take(100),
      ctx.db.query("jobs").withIndex("by_type_runNowAt", (q) => q.eq("type", CONTENT_PLANNING_JOB_TYPE).gte("runNowAt", 0).lte("runNowAt", now)).take(100),
    ]);
    const due = [...new Map([...activeDue, ...manualDue].map((job) => [job._id, job])).values()];
    for (const job of due) {
      const manual = job.runNowAt !== undefined;
      if (job.state === "paused" && !manual) continue;
      const restorePaused = manual && runtimeOf(job).runNowRestorePaused === true;
      const settled = {
        ...(manual ? { runNowAt: undefined, ...(restorePaused ? { state: "paused" as const } : {}) } : {}),
        runtime: consumedRuntime(job),
        updatedAt: now,
        ...(job.state === "active" ? { nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now) } : {}),
      };
      if (!(await agentIsActive(ctx, job))) {
        await ctx.db.patch(job._id, { ...settled, lastRunAt: now, lastOutcome: "failed", lastError: "Strategy Agent is not active" });
        continue;
      }
      const { usable, ignored } = usableTargets(productionTargetsOf(job.config), await planningOptionsOf(ctx, job.instanceId));
      if (usable.length === 0) {
        await ctx.db.patch(job._id, { ...settled, lastOutcome: "skipped", lastSummary: skipSummary(NO_TARGETS_SUMMARY, ignored), lastError: undefined });
        continue;
      }
      if (await hasRunInFlight(ctx, job)) {
        await ctx.db.patch(job._id, { ...settled, lastOutcome: "skipped", lastSummary: "a Content Planning Run is already in progress", lastError: undefined });
        continue;
      }
      const draft = await ctx.db.query("contentPlans").withIndex("by_instance_status", (q) => q.eq("instanceId", job.instanceId).eq("status", "draft")).first();
      if (draft) {
        await ctx.db.patch(job._id, { ...settled, lastOutcome: "skipped", lastSummary: skipSummary(DRAFT_EXISTS_SUMMARY, ignored), lastError: undefined });
        continue;
      }
      const pins = await pinsFor(ctx, job, usable, ignored, now);
      if (pins.targets.every((entry) => entry.remaining === 0)) {
        await ctx.db.patch(job._id, { ...settled, lastOutcome: "succeeded", lastSummary: skipSummary(TARGETS_MET_SUMMARY, ignored), lastError: undefined });
        continue;
      }
      await startRun(ctx, job, pins, settled, now);
    }
  },
});
