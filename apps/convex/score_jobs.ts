import { openClawAgentSlug } from "@opengroow/agent-templates";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";
import { frequencyV } from "./schedules.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { SOURCE_TEMPLATE_ID } from "./source_agent.js";
import {
  buildSourceScoringRunFile,
  isUnscored,
  MAX_SCORING_TRIES,
  scoringRuntime,
  SOURCE_SCORING_JOB_TYPE,
  type SourceScore,
  validateScoringResult,
} from "./source_scoring.js";
import type { RunResult } from "./run_result.js";

const SOURCE_SCAN_LIMIT = 100;

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

function manualRunRequested(job: Doc<"jobs">): boolean {
  return scoringRuntime(job).runNowRequestedAt !== undefined;
}

function restorePausedAfterManualRun(job: Doc<"jobs">): boolean {
  return scoringRuntime(job).runNowRestorePaused === true;
}

async function loadOwnedJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== SOURCE_SCORING_JOB_TYPE) throw new Error("Forbidden");
  await requireOwnedRow(ctx, job);
  return job;
}

async function createRun(ctx: MutationCtx, job: Doc<"jobs">, now: number, sourceIds: Id<"sources">[]): Promise<Id<"runs">> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", SOURCE_TEMPLATE_ID))
    .unique();
  if (!agent?.workspaceKey || agent.status !== "active") throw new Error("Source Agent is not active");
  const runId = await ctx.db.insert("runs", {
    jobId: job._id,
    ownerId: job.ownerId,
    instanceId: job.instanceId,
    templateId: SOURCE_TEMPLATE_ID,
    agentName: agent.openclawAgentName ?? openClawAgentSlug(SOURCE_TEMPLATE_ID),
    sessionKey: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
  await ctx.db.patch(job._id, {
    latestRunId: runId,
    lastRunAt: now,
    runtime: { ...scoringRuntime(job), inFlightRunId: runId, inFlightBatch: { sourceIds }, inFlightTries: 0, inFlightErrors: undefined },
    updatedAt: now,
    ...nextRunPatch(job, now),
  });
  return runId;
}

async function eligibleSources(ctx: MutationCtx, job: Doc<"jobs">): Promise<Doc<"sources">[]> {
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_instance_status_capturedAt", (q) => q.eq("instanceId", job.instanceId).eq("status", "ready"))
    .order("asc")
    .take(SOURCE_SCAN_LIMIT);
  return sources.filter(isUnscored);
}

async function finishJob(ctx: MutationCtx, job: Doc<"jobs">, outcome: "succeeded" | "failed", error?: string): Promise<void> {
  await ctx.db.patch(job._id, {
    runtime: { ...scoringRuntime(job), inFlightRunId: undefined, inFlightBatch: undefined, inFlightTries: undefined, inFlightErrors: undefined },
    lastOutcome: outcome,
    lastError: outcome === "succeeded" ? undefined : error,
    updatedAt: Date.now(),
  });
}

async function applySourceScores(ctx: MutationCtx, scores: SourceScore[]): Promise<void> {
  for (const score of scores) {
    const source = await ctx.db.get(score.sourceId);
    if (!source || !isUnscored(source)) continue;
    const existing = await ctx.db
      .query("creativeFamilies")
      .withIndex("by_instance_slug", (q) => q.eq("instanceId", source.instanceId).eq("slug", score.creativeFamily.slug))
      .unique();
    const creativeFamilyId = existing?._id ?? await ctx.db.insert("creativeFamilies", {
      instanceId: source.instanceId,
      slug: score.creativeFamily.slug,
      name: score.creativeFamily.name,
      description: score.creativeFamily.description,
    });
    await ctx.db.patch(source._id, {
      scoring: { productFit: score.productFit, replicability: score.replicability, creativeStrength: score.creativeStrength },
      creativeFamilyId,
    });
  }
}

async function retryScoringRun(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  run: Pick<Doc<"runs">, "_id" | "agentName">,
  sourceIds: Id<"sources">[],
  tries: number,
  errors: string[] = [],
): Promise<void> {
  const now = Date.now();
  const retryRunId = await ctx.db.insert("runs", {
    jobId: job._id,
    ownerId: job.ownerId,
    instanceId: job.instanceId,
    templateId: SOURCE_TEMPLATE_ID,
    agentName: run.agentName,
    sessionKey: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    resumedFromRunId: run._id,
  });
  await ctx.db.patch(retryRunId, { sessionKey: `mega-run-${retryRunId}` });
  await ctx.db.patch(job._id, {
    latestRunId: retryRunId,
    lastRunAt: now,
    runtime: { ...scoringRuntime(job), inFlightRunId: retryRunId, inFlightBatch: { sourceIds }, inFlightTries: tries, inFlightErrors: errors },
    updatedAt: now,
  });
}

export async function settleScoringRun(
  ctx: MutationCtx,
  run: { _id: Id<"runs">; agentName: string; jobId: Id<"jobs"> },
  result: RunResult,
): Promise<void> {
  if (!run.jobId) return;
  const job = await ctx.db.get(run.jobId);
  if (!job || job.type !== SOURCE_SCORING_JOB_TYPE) return;
  const runtime = scoringRuntime(job);
  if (runtime.inFlightRunId !== run._id || !runtime.inFlightBatch) return;

  const validation = validateScoringResult(result, runtime.inFlightBatch.sourceIds);
  await applySourceScores(ctx, validation.valid);
  if (validation.errors.length > 0) {
    const tries = (runtime.inFlightTries ?? 0) + 1;
    if (tries < MAX_SCORING_TRIES) {
      const validIds = new Set(validation.valid.map((score) => score.sourceId));
      const invalidIds = runtime.inFlightBatch.sourceIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        await retryScoringRun(ctx, job, run, invalidIds, tries, validation.errors);
        return;
      }
    }
    await finishJob(ctx, job, "failed", `Scoring result remained invalid after ${MAX_SCORING_TRIES} tries: ${validation.errors.join("; ")}`);
    return;
  }
  await finishJob(ctx, job, "succeeded");
}

export async function failScoringRun(
  ctx: MutationCtx,
  run: { _id: Id<"runs">; agentName: string; jobId: Id<"jobs"> },
  error: string,
  retry: boolean,
): Promise<void> {
  if (!run.jobId) return;
  const job = await ctx.db.get(run.jobId);
  if (!job || job.type !== SOURCE_SCORING_JOB_TYPE) return;
  const runtime = scoringRuntime(job);
  if (runtime.inFlightRunId !== run._id || !runtime.inFlightBatch) return;
  const tries = (runtime.inFlightTries ?? 0) + 1;
  if (retry && tries < MAX_SCORING_TRIES) {
    await retryScoringRun(ctx, job, run, runtime.inFlightBatch.sourceIds, tries, [error]);
    return;
  }
  await finishJob(ctx, job, "failed", error);
}

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [activeDue, manualDue] = await Promise.all([
      ctx.db
      .query("jobs")
      .withIndex("by_type_state_nextRun", (q) => q.eq("type", SOURCE_SCORING_JOB_TYPE).eq("state", "active").lte("nextRunAt", now))
      .take(100),
      ctx.db
        .query("jobs")
        .withIndex("by_type_runNowAt", (q) => q.eq("type", SOURCE_SCORING_JOB_TYPE).gte("runNowAt", 0).lte("runNowAt", now))
        .take(100),
    ]);
    const due = [...new Map([...activeDue, ...manualDue].map((job) => [job._id, job])).values()];
    for (const job of due.filter((row) => row.type === SOURCE_SCORING_JOB_TYPE)) {
      const manualRun = job.runNowAt !== undefined || manualRunRequested(job);
      const restorePaused = restorePausedAfterManualRun(job);
      if (job.state === "paused" && !manualRun) continue;
      if (!(await sourceAgentIsActive(ctx, job))) {
        await failQueuedRun(ctx, job, now, restorePaused);
        continue;
      }
      await runPass(ctx, job, now);
      if (manualRun) {
        const started = await ctx.db.get(job._id);
        if (started) await ctx.db.patch(job._id, {
          runNowAt: undefined,
          ...(restorePaused ? { state: "paused" } : {}),
          runtime: { ...scoringRuntime(started), runNowRequestedAt: undefined, runNowRestorePaused: undefined },
        });
      }
    }
  },
});

async function sourceAgentIsActive(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", SOURCE_TEMPLATE_ID))
    .unique();
  return agent?.status === "active" && agent.workspaceKey !== undefined;
}

async function failQueuedRun(ctx: MutationCtx, job: Doc<"jobs">, now: number, restorePaused: boolean): Promise<void> {
  await ctx.db.patch(job._id, {
    ...(restorePaused ? { state: "paused" as const } : {}),
    runNowAt: undefined,
    runtime: { ...scoringRuntime(job), runNowRequestedAt: undefined, runNowRestorePaused: undefined },
    lastRunAt: now,
    lastOutcome: "failed",
    lastError: "Source Agent is not active",
    updatedAt: now,
    ...nextRunPatch(job, now),
  });
}

export async function runPass(ctx: MutationCtx, job: Doc<"jobs">, now: number): Promise<number> {
  const runtime = scoringRuntime(job);
  if (runtime.inFlightRunId) {
    const run = await ctx.db.get(runtime.inFlightRunId);
    if (run && ["pending", "dispatching", "running", "awaiting_job"].includes(run.status)) {
      await ctx.db.patch(job._id, { lastRunAt: now, lastOutcome: "skipped", updatedAt: now, ...nextRunPatch(job, now) });
      return 0;
    }
  }
  const sources = await eligibleSources(ctx, job);
  if (sources.length === 0) {
    await ctx.db.patch(job._id, { lastRunAt: now, lastOutcome: "succeeded", lastError: undefined, updatedAt: now, ...nextRunPatch(job, now) });
    return 0;
  }
  await createRun(ctx, job, now, sources.map((source) => source._id));
  return sources.length;
}

export const runNow = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => await runPass(ctx, await loadOwnedJob(ctx, args.jobId), Date.now()),
});

export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerIds = await ownerIdsFor(ctx, args.instanceId);
    if (ownerIds === null) return [];
    const jobs = await ctx.db.query("jobs").withIndex("by_instance_type_template", (q) =>
      q.eq("instanceId", args.instanceId).eq("type", SOURCE_SCORING_JOB_TYPE).eq("templateId", SOURCE_TEMPLATE_ID),
    ).take(100);
    const agent = await ctx.db.query("projectAgents").withIndex("by_instance_template", (q) =>
      q.eq("instanceId", args.instanceId).eq("templateId", SOURCE_TEMPLATE_ID),
    ).unique();
    return await Promise.all(jobs.filter((job) => ownerIds.has(job.ownerId)).map(async (job) => {
      const inFlightRunId = scoringRuntime(job).inFlightRunId;
      const inFlightRun = inFlightRunId ? await ctx.db.get(inFlightRunId) : null;
      return {
        _id: job._id,
        jobType: "score" as const,
        templateId: SOURCE_TEMPLATE_ID,
        agentName: "Source scoring",
        state: job.state,
        unit: job.unit,
        dayOfWeek: job.dayOfWeek,
        dayOfMonth: job.dayOfMonth,
        hour: job.hour,
        minute: job.minute,
        timezone: job.timezone,
        nextRunAt: job.nextRunAt,
        lastRunAt: job.lastRunAt,
        lastOutcome: job.lastOutcome,
        lastError: job.lastError,
        running: inFlightRun !== null && ["pending", "dispatching", "running", "awaiting_job"].includes(inFlightRun.status),
        workspaceKey: agent?.workspaceKey,
        latestRunId: job.latestRunId,
      };
    }));
  },
});

export const setFrequency = mutation({
  args: { jobId: v.id("jobs"), frequency: frequencyV, timezone: v.string() },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const frequency = args.frequency as Frequency;
    const inRange = (n: number | undefined, min: number, max: number) => n !== undefined && Number.isInteger(n) && n >= min && n <= max;
    if (!inRange(frequency.hour, 0, 23) || !inRange(frequency.minute, 0, 59)) throw new Error("Invalid time of day");
    if (frequency.unit === "weekly" && !inRange(frequency.dayOfWeek, 0, 6)) throw new Error("Invalid day of week");
    if (frequency.unit === "monthly" && !inRange(frequency.dayOfMonth, 1, 31)) throw new Error("Invalid day of month");
    const now = Date.now();
    await ctx.db.patch(job._id, {
      unit: frequency.unit,
      dayOfWeek: frequency.unit === "weekly" ? frequency.dayOfWeek : undefined,
      dayOfMonth: frequency.unit === "monthly" ? frequency.dayOfMonth : undefined,
      hour: frequency.hour,
      minute: frequency.minute,
      timezone: args.timezone,
      nextRunAt: computeNextRunAt(frequency, args.timezone, now),
      updatedAt: now,
    });
  },
});

export const pause = mutation({ args: { jobId: v.id("jobs") }, handler: async (ctx, args) => {
  const job = await loadOwnedJob(ctx, args.jobId);
  await ctx.db.patch(job._id, { state: "paused", updatedAt: Date.now() });
} });

export const resume = mutation({ args: { jobId: v.id("jobs") }, handler: async (ctx, args) => {
  const job = await loadOwnedJob(ctx, args.jobId);
  const now = Date.now();
  await ctx.db.patch(job._id, { state: "active", nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now), updatedAt: now });
} });

export const isSourceScoringRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return false;
    const jobId = (run as typeof run & { jobId?: Id<"jobs"> }).jobId;
    if (!jobId) return false;
    return (await ctx.db.get(jobId))?.type === SOURCE_SCORING_JOB_TYPE;
  },
});

export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const jobId = (run as typeof run & { jobId?: Id<"jobs"> }).jobId;
    if (!jobId) return null;
    const job = await ctx.db.get(jobId);
    if (!job || job.type !== SOURCE_SCORING_JOB_TYPE) return null;
    const runtime = scoringRuntime(job);
    if (runtime.inFlightRunId !== run._id || !runtime.inFlightBatch) return null;
    const agent = await ctx.db.query("projectAgents").withIndex("by_instance_template", (q) =>
      q.eq("instanceId", run.instanceId).eq("templateId", SOURCE_TEMPLATE_ID),
    ).unique();
    if (!agent?.workspaceKey) return null;
    const sources = [];
    for (const sourceId of runtime.inFlightBatch.sourceIds) {
      const source = await ctx.db.get(sourceId);
      if (source) sources.push(source);
    }
    return {
      run: { _id: run._id, agentName: run.agentName, sessionKey: run.sessionKey },
      workspaceKey: agent.workspaceKey,
      instanceId: run.instanceId,
      templateId: job.templateId,
      jobId: job._id,
      sources,
      feedback: runtime.inFlightErrors,
    };
  },
});

export { buildSourceScoringRunFile };
