import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server.js";
import { latestOf } from "./strategic_reviews.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { requireOwnedRow } from "./instance_ownership.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { CONTEXT_PROVIDER_RENDERERS } from "./mission_dispatcher/context_providers.js";

// The `strategic_review` Job type (ADR-085, issue #166). A Job of the Strategy
// Agent, not a Mission: it has its own recurrence and Run Now, creates no
// Mission and no Production Recipe. When a Run starts, Convex pins on the Run
// (`run.strategicReview`) the analysis period resolved from `analysisDays` and
// the Project's latest Strategic Review as its base; neither comes from the
// Agent. What the Run returns is handled elsewhere (#168).

export const STRATEGIC_REVIEW_JOB_TYPE = "strategic_review" as const;
export const DEFAULT_ANALYSIS_DAYS = 30;
export const MIN_ANALYSIS_DAYS = 1;
export const MAX_ANALYSIS_DAYS = 365;
/** Tries of one execution (the first plus its retries after an invalid result). */
export const MAX_STRATEGIC_REVIEW_TRIES = 3;

const DAY_MS = 86_400_000;
const IN_FLIGHT = new Set(["pending", "dispatching", "running", "awaiting_job"]);

export type StrategicReviewPins = NonNullable<Doc<"runs">["strategicReview"]>;

type StrategicReviewRuntime = {
  runNowRequestedAt?: number;
  runNowRestorePaused?: boolean;
  inFlightRunId?: Id<"runs">;
  inFlightTries?: number;
  inFlightErrors?: string[];
};

function runtimeOf(job: Doc<"jobs">): StrategicReviewRuntime {
  return job.runtime && typeof job.runtime === "object" && !Array.isArray(job.runtime) ? (job.runtime as StrategicReviewRuntime) : {};
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

function nextRunPatch(job: Doc<"jobs">, now: number) {
  return job.state === "active" ? { nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now) } : {};
}

export function isValidAnalysisDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_ANALYSIS_DAYS && value <= MAX_ANALYSIS_DAYS;
}

/** The Job's `analysisDays`; the default when the config holds none or an invalid one. */
export function analysisDaysOf(job: Pick<Doc<"jobs">, "config">): number {
  const config = job.config;
  const value = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>).analysisDays : undefined;
  return isValidAnalysisDays(value) ? value : DEFAULT_ANALYSIS_DAYS;
}

/** The text a Strategic Review Run reads: the pinned period and how to use it (context provider). */
export function buildStrategicReviewRunFile(pins: { periodStart: number; periodEnd: number }): string {
  const section = CONTEXT_PROVIDER_RENDERERS["strategic-review-period"](pins);
  return [
    "# Strategic Review",
    "",
    "This session is a Strategic Review Job, not a Mission: analyze the performance of the period below and return the result described in your Job instructions (jobs/strategic-review.md). Nothing here creates a Mission.",
    "",
    section ?? "",
  ].join("\n");
}

async function loadOwnedJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== STRATEGIC_REVIEW_JOB_TYPE) throw new Error("Forbidden");
  await requireOwnedRow(ctx, job);
  return job;
}

/** Sets how many days back a Run analyzes. The frequency is the Job's own recurrence, independent of it. */
export const setAnalysisDays = mutation({
  args: { jobId: v.id("jobs"), analysisDays: v.number() },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    if (!isValidAnalysisDays(args.analysisDays)) {
      throw new Error(`analysisDays must be an integer between ${MIN_ANALYSIS_DAYS} and ${MAX_ANALYSIS_DAYS}`);
    }
    const config = job.config && typeof job.config === "object" && !Array.isArray(job.config) ? job.config : {};
    await ctx.db.patch(job._id, { config: { ...config, analysisDays: args.analysisDays }, updatedAt: Date.now() });
  },
});

async function agentIsActive(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  return agent?.status === "active" && agent.workspaceKey !== undefined;
}

async function hasRunInFlight(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  const runId = runtimeOf(job).inFlightRunId;
  const run = runId ? await ctx.db.get(runId) : null;
  return run !== null && IN_FLIGHT.has(run.status);
}

async function agentNameOf(ctx: MutationCtx, job: Doc<"jobs">): Promise<string> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  return agent?.openclawAgentName ?? job.templateId;
}

/** Creates the Run with its pins: the period ends now, the base is the Project's latest Review. */
async function startRun(ctx: MutationCtx, job: Doc<"jobs">, now: number): Promise<Id<"runs">> {
  const latest = await latestOf(ctx, job.instanceId);
  const pins: StrategicReviewPins = {
    periodStart: now - analysisDaysOf(job) * DAY_MS,
    periodEnd: now,
    ...(latest ? { baseReviewId: latest._id } : {}),
  };
  const runId = await ctx.db.insert("runs", {
    jobId: job._id, ownerId: job.ownerId, instanceId: job.instanceId, templateId: job.templateId,
    agentName: await agentNameOf(ctx, job), sessionKey: "", status: "pending", strategicReview: pins, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
  await ctx.db.patch(job._id, {
    latestRunId: runId, lastRunAt: now,
    runtime: { ...consumedRuntime(job), inFlightRunId: runId, inFlightTries: 0 },
    updatedAt: now,
    ...nextRunPatch(job, now),
  });
  return runId;
}

/** The runtime once the manual claim is consumed (an in-flight marker is set by the caller). */
function consumedRuntime(job: Doc<"jobs">): StrategicReviewRuntime {
  const { runNowRequestedAt: _a, runNowRestorePaused: _b, ...rest } = runtimeOf(job);
  return rest;
}

/** A retry of a Run that failed on an invalid result: a new Run holding the same pins. */
async function retryRun(ctx: MutationCtx, job: Doc<"jobs">, run: Doc<"runs">, tries: number, errors: string[]): Promise<void> {
  const now = Date.now();
  const retryId = await ctx.db.insert("runs", {
    jobId: job._id, ownerId: job.ownerId, instanceId: job.instanceId, templateId: job.templateId,
    agentName: run.agentName, sessionKey: "", status: "pending", resumedFromRunId: run._id,
    ...(run.strategicReview ? { strategicReview: run.strategicReview } : {}),
    createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(retryId, { sessionKey: `mega-run-${retryId}` });
  await ctx.db.patch(job._id, {
    latestRunId: retryId, lastRunAt: now,
    runtime: { ...runtimeOf(job), inFlightRunId: retryId, inFlightTries: tries, inFlightErrors: errors },
    updatedAt: now,
  });
}

/** Ends the Job's current execution with an outcome; the manual claim of a newer Run Now is kept. */
export async function finishStrategicReviewJob(ctx: MutationCtx, job: Doc<"jobs">, outcome: "succeeded" | "failed", summary?: string, error?: string): Promise<void> {
  const runtime = runtimeOf(job);
  await ctx.db.patch(job._id, {
    runtime: {
      ...(runtime.runNowRequestedAt !== undefined ? { runNowRequestedAt: runtime.runNowRequestedAt } : {}),
      ...(runtime.runNowRestorePaused !== undefined ? { runNowRestorePaused: runtime.runNowRestorePaused } : {}),
    },
    lastOutcome: outcome,
    lastSummary: summary,
    lastError: outcome === "failed" ? error : undefined,
    updatedAt: Date.now(),
  });
}

/** A Run failed or was cancelled: retried with the same pins when asked and within budget, else the Job fails. */
export async function failStrategicReviewRun(ctx: MutationCtx, run: Doc<"runs">, jobId: Id<"jobs">, error: string, retry: boolean): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== STRATEGIC_REVIEW_JOB_TYPE) return;
  const runtime = runtimeOf(job);
  if (runtime.inFlightRunId !== run._id) return;
  const tries = (runtime.inFlightTries ?? 0) + 1;
  if (retry && tries < MAX_STRATEGIC_REVIEW_TRIES) {
    await retryRun(ctx, job, run, tries, [error]);
    return;
  }
  await finishStrategicReviewJob(ctx, job, "failed", undefined, error);
}

/** Starts the due Runs: scheduled passes of active Jobs and queued Run Now requests. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [activeDue, manualDue] = await Promise.all([
      ctx.db.query("jobs").withIndex("by_type_state_nextRun", (q) => q.eq("type", STRATEGIC_REVIEW_JOB_TYPE).eq("state", "active").lte("nextRunAt", now)).take(100),
      ctx.db.query("jobs").withIndex("by_type_runNowAt", (q) => q.eq("type", STRATEGIC_REVIEW_JOB_TYPE).gte("runNowAt", 0).lte("runNowAt", now)).take(100),
    ]);
    const due = [...new Map([...activeDue, ...manualDue].map((job) => [job._id, job])).values()];
    for (const job of due) {
      const manual = job.runNowAt !== undefined;
      const restorePaused = manual && runtimeOf(job).runNowRestorePaused === true;
      if (job.state === "paused" && !manual) continue;
      const settleManual = {
        ...(manual ? { runNowAt: undefined, ...(restorePaused ? { state: "paused" as const } : {}) } : {}),
      };
      if (await hasRunInFlight(ctx, job)) {
        // A Run is already analyzing: this pass is skipped, a manual request is consumed.
        await ctx.db.patch(job._id, { ...settleManual, runtime: consumedRuntime(job), lastOutcome: "skipped", updatedAt: now, ...nextRunPatch(job, now) });
        continue;
      }
      if (!(await agentIsActive(ctx, job))) {
        await ctx.db.patch(job._id, {
          ...settleManual, runtime: consumedRuntime(job), lastRunAt: now, lastOutcome: "failed", lastError: "Strategy Agent is not active", updatedAt: now, ...nextRunPatch(job, now),
        });
        continue;
      }
      await ctx.db.patch(job._id, settleManual);
      await startRun(ctx, job, now);
    }
  },
});

export const isStrategicReviewRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const jobId = (run as (typeof run & { jobId?: Id<"jobs"> }) | null)?.jobId;
    return jobId !== undefined && (await ctx.db.get(jobId))?.type === STRATEGIC_REVIEW_JOB_TYPE;
  },
});

/** What dispatching a Run needs; the pins come from the Run itself, never recomputed. */
export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const jobId = (run as (typeof run & { jobId?: Id<"jobs"> }) | null)?.jobId;
    if (!run || !jobId || !run.strategicReview) return null;
    const job = await ctx.db.get(jobId);
    if (!job || job.type !== STRATEGIC_REVIEW_JOB_TYPE) return null;
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
      pins: run.strategicReview,
    };
  },
});
