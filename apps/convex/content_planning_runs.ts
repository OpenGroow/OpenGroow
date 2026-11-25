import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { persistContentPlan } from "./content_plans.js";
import { parseContentPlanEnvelope } from "./content_plan_rules.js";
import { CONTENT_PLANNING_JOB_TYPE, MAX_CONTENT_PLANNING_TRIES, runtimeOf, type ContentPlanningPins, type Runtime } from "./content_planning_shared.js";
import type { RunResult } from "./run_result.js";

// The life of a Content Planning Run (ADR-086): its creation with the pins, the retry of a refused result, and how a
// result file or a failure ends it. The pass that decides whether a Run starts at all is in content_planning_jobs.

/** Creates the Run holding its pins; the Job's manual claim is consumed and its next run advanced. */
export async function startRun(ctx: MutationCtx, job: Doc<"jobs">, pins: ContentPlanningPins, settled: Record<string, unknown>, now: number): Promise<void> {
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
    ...settled, latestRunId: runId, lastRunAt: now, runtime: { ...(settled.runtime as Runtime), inFlightRunId: runId, inFlightTries: 0 }, lastError: undefined,
  });
}

/** A retry of a Run whose result was refused: a new Run holding the very same pins, with the reasons to feed back. */
async function retryRun(ctx: MutationCtx, job: Doc<"jobs">, run: Doc<"runs">, tries: number, reasons: string[]): Promise<void> {
  const now = Date.now();
  const retryId = await ctx.db.insert("runs", {
    jobId: job._id, ownerId: job.ownerId, instanceId: job.instanceId, templateId: job.templateId,
    agentName: run.agentName, sessionKey: "", status: "pending", resumedFromRunId: run._id,
    ...(run.contentPlanning ? { contentPlanning: run.contentPlanning } : {}),
    createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(retryId, { sessionKey: `mega-run-${retryId}` });
  await ctx.db.patch(job._id, {
    latestRunId: retryId, lastRunAt: now,
    runtime: { ...runtimeOf(job), inFlightRunId: retryId, inFlightTries: tries, inFlightErrors: reasons },
    updatedAt: now,
  });
}

/**
 * A Content Planning Run failed or was cancelled before a plan was persisted. When `reasons` are given (a refused or
 * unreadable result) and the budget allows, a new Run with the same pins is started; otherwise the Job's execution
 * ends as failed with `error`.
 */
export async function failContentPlanningRun(ctx: MutationCtx, run: Doc<"runs">, jobId: Id<"jobs">, error: string, reasons?: string[]): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== CONTENT_PLANNING_JOB_TYPE || runtimeOf(job).inFlightRunId !== run._id) return;
  const runtime = runtimeOf(job);
  const tries = (typeof runtime.inFlightTries === "number" ? runtime.inFlightTries : 0) + 1;
  if (reasons && run.contentPlanning && tries < MAX_CONTENT_PLANNING_TRIES) {
    await retryRun(ctx, job, run, tries, reasons);
    return;
  }
  const { inFlightRunId: _run, inFlightTries: _tries, inFlightErrors: _errors, ...rest } = runtime;
  await ctx.db.patch(job._id, { runtime: rest, lastOutcome: "failed", lastError: error, updatedAt: Date.now() });
}

/** Ends the Job's current execution: the in-flight marker is cleared and the outcome recorded (a newer manual claim is kept). */
async function finishContentPlanningJob(ctx: MutationCtx, job: Doc<"jobs">, outcome: "succeeded" | "failed", summary?: string, error?: string): Promise<void> {
  const { inFlightRunId: _run, inFlightTries: _tries, inFlightErrors: _errors, ...rest } = runtimeOf(job);
  await ctx.db.patch(job._id, { runtime: rest, lastOutcome: outcome, lastSummary: summary, lastError: outcome === "failed" ? error : undefined, updatedAt: Date.now() });
}

/**
 * A content_planning Run ended with its result file (#176): validated as a whole and persisted as a draft Content Plan
 * (the Agent's `items: []` completes the Run with its rationale and no plan). A result that cannot be persisted fails
 * the Run with the reasons and creates nothing. A Run already settled is left as it is.
 */
export async function settleContentPlanningRun(ctx: MutationCtx, run: Doc<"runs">, jobId: Id<"jobs">, result: RunResult, envelope: unknown): Promise<void> {
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
  const now = Date.now();
  const outcome = envelope === undefined
    ? ({ ok: false, reason: "invalid_result", message: "The Run returned no Content Plan result." } as const)
    : await persistContentPlan(ctx, run, envelope);
  if (!outcome.ok) {
    const errorMessage = `${outcome.reason}: ${outcome.message}`;
    await ctx.db.patch(run._id, { status: "failed", errorMessage, completedAt: now, updatedAt: now });
    await failContentPlanningRun(ctx, run, jobId, errorMessage, outcome.reason === "invalid_result" ? ("errors" in outcome && outcome.errors ? outcome.errors : [outcome.message]) : undefined);
    return;
  }
  await ctx.db.patch(run._id, { status: "completed", result, completedAt: now, updatedAt: now });
  const job = await ctx.db.get(jobId);
  if (!job || runtimeOf(job).inFlightRunId !== run._id) return;
  const parsed = run.contentPlanning ? parseContentPlanEnvelope(envelope, run.contentPlanning) : undefined;
  const summary = outcome.planId === null
    ? (parsed?.ok ? parsed.value.rationale : "No content planned")
    : `Content Plan drafted with ${outcome.count} content${outcome.count === 1 ? "" : "s"}, waiting for review`;
  await finishContentPlanningJob(ctx, job, "succeeded", summary);
}

