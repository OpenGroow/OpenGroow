import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { persistContentPlan } from "./content_plans.js";
import { CONTENT_PLANNING_JOB_TYPE, MAX_CONTENT_PLANNING_TRIES, runtimeOf, type ContentPlanningPins, type Runtime } from "./content_planning_shared.js";
import type { RunResult } from "./run_result.js";
import { newRunBlock } from "./template_runnable.js";

// The life of a Content Planning Run (ADR-086): its creation with the pins, the retry of a refused result, and how a
// result file or a failure ends it. The pass that decides whether a Run starts at all is in content_planning_jobs.

/** The runtime of a Job once its current execution ended: the in-flight marker is gone, the rest is kept. */
function clearInFlight(runtime: Runtime): Runtime {
  const { inFlightRunId: _run, inFlightTries: _tries, inFlightErrors: _errors, ...rest } = runtime;
  return rest;
}

/** Inserts a pending Run of the Job and makes it the Job's in-flight one, with `runtime` and the other `job` fields. */
async function launchRun(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  now: number,
  run: Pick<Doc<"runs">, "agentName" | "contentPlanning" | "resumedFromRunId">,
  runtime: Runtime,
  jobFields: Partial<Doc<"jobs">>,
): Promise<void> {
  const runId = await ctx.db.insert("runs", {
    jobId: job._id, ownerId: job.ownerId, instanceId: job.instanceId, templateId: job.templateId,
    sessionKey: "", status: "pending", createdAt: now, updatedAt: now,
    agentName: run.agentName,
    ...(run.resumedFromRunId ? { resumedFromRunId: run.resumedFromRunId } : {}),
    ...(run.contentPlanning ? { contentPlanning: run.contentPlanning } : {}),
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
  await ctx.db.patch(job._id, { ...jobFields, latestRunId: runId, lastRunAt: now, runtime: { ...runtime, inFlightRunId: runId } });
}

/** Creates the Run holding its pins; the Job's manual claim is consumed and its next run advanced. */
export async function startRun(ctx: MutationCtx, job: Doc<"jobs">, pins: ContentPlanningPins, settled: Record<string, unknown>, now: number): Promise<void> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  await launchRun(
    ctx, job, now, { agentName: agent?.openclawAgentName ?? job.templateId, contentPlanning: pins },
    { ...(settled.runtime as Runtime), inFlightTries: 0 }, { ...settled, lastError: undefined },
  );
}

/** A retry of a Run whose result was refused: a new Run holding the very same pins, with the reasons to feed back. */
async function retryRun(ctx: MutationCtx, job: Doc<"jobs">, run: Doc<"runs">, tries: number, reasons: string[]): Promise<void> {
  const now = Date.now();
  await launchRun(
    ctx, job, now, { agentName: run.agentName, contentPlanning: run.contentPlanning, resumedFromRunId: run._id },
    { ...runtimeOf(job), inFlightTries: tries, inFlightErrors: reasons }, { updatedAt: now },
  );
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
  const retryable = reasons !== undefined && run.contentPlanning !== undefined && tries < MAX_CONTENT_PLANNING_TRIES;
  // ADR-091: a retry is a new Run, refused on an outdated Template; the Job's execution ends with the reason.
  const block = retryable ? await newRunBlock(ctx, job.instanceId, job.templateId) : null;
  if (retryable && !block && reasons) {
    await retryRun(ctx, job, run, tries, reasons);
    return;
  }
  await ctx.db.patch(job._id, { runtime: clearInFlight(runtime), lastOutcome: "failed", lastError: block ?? error, updatedAt: Date.now() });
}

/** Ends the Job's current execution: the in-flight marker is cleared and the outcome recorded (a newer manual claim is kept). */
async function finishContentPlanningJob(ctx: MutationCtx, job: Doc<"jobs">, outcome: "succeeded" | "failed", summary?: string, error?: string): Promise<void> {
  await ctx.db.patch(job._id, { runtime: clearInFlight(runtimeOf(job)), lastOutcome: outcome, lastSummary: summary, lastError: outcome === "failed" ? error : undefined, updatedAt: Date.now() });
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
    ? ({ ok: false, reason: "invalid_result", message: "The Run returned no Content Plan result.", errors: ["The Run returned no Content Plan result."] as string[] } as const)
    : await persistContentPlan(ctx, run, envelope);
  if (!outcome.ok) {
    const errorMessage = `${outcome.reason}: ${outcome.message}`;
    await ctx.db.patch(run._id, { status: "failed", errorMessage, completedAt: now, updatedAt: now });
    await failContentPlanningRun(ctx, run, jobId, errorMessage, outcome.reason === "invalid_result" ? outcome.errors : undefined);
    return;
  }
  await ctx.db.patch(run._id, { status: "completed", result, completedAt: now, updatedAt: now });
  const job = await ctx.db.get(jobId);
  if (!job || runtimeOf(job).inFlightRunId !== run._id) return;
  const summary = outcome.planId === null
    ? (outcome.rationale ?? "No content planned")
    : `Content Plan drafted with ${outcome.count} content${outcome.count === 1 ? "" : "s"}, waiting for review`;
  await finishContentPlanningJob(ctx, job, "succeeded", summary);
}

