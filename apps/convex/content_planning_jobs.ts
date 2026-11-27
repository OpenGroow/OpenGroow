import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { getTemplateRegistry } from "./template_registry.js";
import { skipJobOnOutdatedTemplate } from "./jobs_outdated.js";
import { allChannels, projectPublishers } from "./project_publishers.js";
import { standaloneInFlight } from "./recipe_generation_shared.js";
import { startRun } from "./content_planning_runs.js";
import { approvedCountsByKind } from "./content_plan_counts.js";
import { CONTENT_PLANNING_JOB_TYPE, runtimeOf, type ContentPlanningPins, type Runtime } from "./content_planning_shared.js";
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

export const NO_TARGETS_SUMMARY = "no production targets configured";
export const DRAFT_EXISTS_SUMMARY = "a draft Content Plan is waiting for review";
export const TARGETS_MET_SUMMARY = "targets already met";

const IN_FLIGHT = new Set(["pending", "dispatching", "running", "awaiting_job"]);

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
  const [templates, publishers] = await Promise.all([
    Promise.all(agents.map((agent) => registry.resolve(instanceId, agent.templateId))),
    projectPublishers(ctx, instanceId),
  ]);
  for (const [index, agent] of agents.entries()) {
    const template = templates[index];
    const hidden = new Set(agent.hiddenMissionTypes ?? []);
    for (const missionType of template?.manifest.missionTypes ?? []) {
      if (!hidden.has(missionType.type) && missionType.publish?.kind) formats.add(missionType.publish.kind);
    }
  }
  const publishTargets = allChannels(publishers).map((channel) => channel.target);
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

/**
 * The reason a stored configuration may not start a Run (horizon outside its bounds, total quantity over the limit,
 * a format listed twice...), or null. The shared validator is applied to its structure only: a format or Publish target
 * the Project no longer offers is not an error here, `usableTargets` ignores it and reports it.
 */
function invalidStoredConfig(config: unknown): string | null {
  const stored = config === undefined || config === null ? defaultContentPlanningConfig() : config;
  const targets = productionTargetsOf(stored);
  const checked = validateContentPlanningConfig(stored, {
    formats: targets.map((target) => target.kind),
    publishTargets: targets.flatMap((target) => target.publishTargets),
  });
  return checked.ok ? null : `The stored configuration is invalid: ${checked.errors.join(" ")}`;
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
  const approved = await approvedCountsByKind(ctx, job.instanceId, periodStart, periodEnd);
  return {
    periodStart,
    periodEnd,
    targets: usable.map((entry) => {
      const existing = approved.get(entry.kind) ?? 0;
      return { kind: entry.kind, target: entry.quantity, existing, remaining: remainingOf(entry.quantity, existing), publishTargets: entry.publishTargets };
    }),
    ignored: [...ignored],
  };
}

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
      if (await skipJobOnOutdatedTemplate(ctx, job, now)) continue;
      // A Standalone Run holds the Agent (ADR-087): postpone without writing, the Job stays due and a Run Now stays queued.
      if (await standaloneInFlight(ctx, job.instanceId, job.templateId)) continue;
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
      const invalid = invalidStoredConfig(job.config);
      if (invalid) {
        await ctx.db.patch(job._id, { ...settled, lastRunAt: now, lastOutcome: "failed", lastError: invalid });
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
