import { openClawAgentSlug } from "@opengroow/agent-templates";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { readOwnerId, requireOwnedRow } from "./instance_ownership.js";
import { ownerOfInstance } from "./projects.js";
import { frequencyV } from "./schedules.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { listMissionRunsCompletedBetween } from "./runs.js";
import { templateHasEnrichment } from "./source_enrichment.js";
import { getTemplateRegistry } from "./template_registry.js";
import { runParent, type RunParentRecord } from "./run_parent.js";
import { jobResultFilePath, jobRunFilePath } from "./source_jobs/job_files.js";
import { RUNTIME_WORKSPACE_FILE_DELETE_BATCH } from "@opengroow/protocol";
import { enqueueCommand } from "./commands.js";
import { feedbackOf, MAX_SOURCE_TRIES, type TryFeedback } from "./source_jobs/retry_feedback.js";

// Source ingestion is a concrete capability of the generic Job aggregate.
// Source-specific cursor/chain state lives in `jobs.runtime`.

// Activation default: daily at 06:00 UTC. The user edits it from the Jobs page.
const DEFAULT_FREQUENCY: Frequency = { unit: "daily", hour: 6, minute: 0 };
const DEFAULT_TIMEZONE = "UTC";

const IN_FLIGHT_RUN_STATUSES: ReadonlySet<Doc<"runs">["status"]> = new Set([
  "pending",
  "dispatching",
  "running",
  "awaiting_job",
]);

// Patch that clears a job's in-flight execution state (one place, so a new
// in-flight field cannot be missed at a settle/reset site).
const CLEARED_IN_FLIGHT = {
  inFlightRunId: undefined,
  inFlightResumes: undefined,
  inFlightTries: undefined,
  inFlightBatch: undefined,
  inFlightChained: undefined,
};

const RETRY_SOURCES_LIMIT = 100;
const AWAITING_ENRICHMENT_LIMIT = 50;

type SourceJobBatch = {
  boundAt: number;
  runIds: Id<"runs">[];
  retrySourceIds: Id<"sources">[];
};

type SourceJobRuntime = {
  cursorAt: number;
  runNowRequestedAt?: number;
  runNowRestorePaused?: boolean;
  inFlightRunId?: Id<"runs">;
  inFlightResumes?: number;
  inFlightTries?: number;
  inFlightChained?: number;
  inFlightBatch?: SourceJobBatch;
};

type SourceJob = Doc<"jobs"> & SourceJobRuntime;

function sourceRuntime(job: Doc<"jobs">): SourceJobRuntime {
  const runtime = job.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return { cursorAt: 0 };
  const value = runtime as Partial<SourceJobRuntime>;
  return { cursorAt: typeof value.cursorAt === "number" ? value.cursorAt : 0, ...value };
}

function asSourceJob(job: Doc<"jobs">): SourceJob {
  return { ...job, ...sourceRuntime(job) };
}

async function patchSourceRuntime(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  patch: Partial<SourceJobRuntime>,
  fields: Record<string, unknown> = {},
): Promise<void> {
  await ctx.db.patch(job._id, {
    ...fields,
    runtime: { ...sourceRuntime(job), ...patch },
    updatedAt: Date.now(),
  });
}

// Bound on the executions one tick may resume after an enrichment (one per
// handoff). A Source is completed by the resumed execution; an Agent that keeps
// handing off without completing anything would otherwise loop on the user's key.
export const MAX_ENRICHMENT_RESUMES = 50;

// Bound on the follow-up executions chained after a success while Sources still
// await their enrichment handoff (#579): a Source whose handoff never happens
// would otherwise loop on the user's key. A handoff that *succeeds* consumes a
// follow-up too, so the bound has to cover a whole batch of awaiting Sources —
// anything below `AWAITING_ENRICHMENT_LIMIT` would fail a job that is making
// progress, with a reason ("still awaiting enrichment") that would not be true.
export const MAX_CHAINED_EXECUTIONS = AWAITING_ENRICHMENT_LIMIT;

function frequencyOf(job: Doc<"jobs">): Frequency {
  return {
    unit: job.unit,
    ...(job.dayOfWeek !== undefined ? { dayOfWeek: job.dayOfWeek } : {}),
    ...(job.dayOfMonth !== undefined ? { dayOfMonth: job.dayOfMonth } : {}),
    hour: job.hour,
    minute: job.minute,
  };
}

async function findJob(ctx: MutationCtx, instanceId: string, templateId: string) {
  return await ctx.db
    .query("jobs")
    .withIndex("by_instance_type_template", (q) =>
      q.eq("instanceId", instanceId).eq("type", "source_ingestion").eq("templateId", templateId),
    )
    .unique();
}

/**
 * The Project owner (`projects.ownerId`) may hold the token identifier (`<issuer>|<subject>`), but
 * every ownership check compares against the bare `subject` (what Missions and
 * `readOwnerId` use). Jobs store the bare form so they stay visible to their owner.
 */
function ownerSubjectOf(userId: string): string {
  return userId.slice(userId.lastIndexOf("|") + 1);
}

/**
 * Creates the Agent's `active` daily job with its cursor at `cursorAt`.
 * Returns false when the Instance has no owner: Runs and Sources are
 * owner-scoped, so there is nothing to attach the job to.
 */
export async function insertSourceIngestionJobForAgent(
  ctx: MutationCtx,
  agent: { instanceId: string; templateId: string },
  cursorAt: number,
): Promise<boolean> {
  const now = Date.now();
  const instance = await ctx.db
    .query("instances")
    .withIndex("by_openclaw_id", (q) => q.eq("openclawId", agent.instanceId))
    .first();
  const instanceOwner = instance ? await ownerOfInstance(ctx, instance) : undefined;
  if (!instanceOwner) return false;

  await ctx.db.insert("jobs", {
    ownerId: ownerSubjectOf(instanceOwner),
    instanceId: agent.instanceId,
    templateId: agent.templateId,
    type: "source_ingestion",
    state: "active",
    config: {},
    runtime: { cursorAt },
    unit: DEFAULT_FREQUENCY.unit,
    hour: DEFAULT_FREQUENCY.hour,
    minute: DEFAULT_FREQUENCY.minute,
    timezone: DEFAULT_TIMEZONE,
    nextRunAt: computeNextRunAt(DEFAULT_FREQUENCY, DEFAULT_TIMEZONE, now),
    createdAt: now,
    updatedAt: now,
  });
  return true;
}

const SOURCE_JOB_BATCH_SIZE = 15;

/**
 * The batch of one execution: Runs of the Agent's Missions completed after the
 * cursor and up to a bound fixed now (all four terminal outcomes), plus the
 * Sources flagged for retry. When the backlog exceeds one page the bound is
 * pulled back to the last Run returned, so the cursor never skips the rest.
 */
async function buildBatch(ctx: MutationCtx, job: SourceJob, now: number) {
  const completed = (
    await listMissionRunsCompletedBetween(ctx, {
      instanceId: job.instanceId,
      templateId: job.templateId,
      since: job.cursorAt,
      until: now,
    })
  ).filter((run) => (run.completedAt ?? 0) > job.cursorAt);
  // The agent reads every report within one execution timeout: a backlog is drained over successive ticks.
  const runs = completed.slice(0, SOURCE_JOB_BATCH_SIZE);
  const truncated = completed.length > runs.length;
  const boundAt = truncated ? (runs[runs.length - 1].completedAt ?? now) : now;
  const retrySources = await ctx.db
    .query("sources")
    .withIndex("by_instance_template_retry", (q) =>
      q.eq("instanceId", job.instanceId).eq("templateId", job.templateId).eq("retryRequested", true),
    )
    .take(RETRY_SOURCES_LIMIT);
  return {
    boundAt,
    runIds: runs.map((r) => r._id),
    retrySourceIds: retrySources.map((s) => s._id),
  };
}

/** One pending execution Run parented to a SourceJob, in its own session. */
async function insertExecutionRun(
  ctx: MutationCtx,
  job: SourceJob,
  agentName: string,
  now: number,
  resumedFromRunId?: Id<"runs">,
): Promise<Id<"runs">> {
  const runId = await ctx.db.insert("runs", {
    jobId: job._id,
    ...(resumedFromRunId ? { resumedFromRunId } : {}),
    ownerId: job.ownerId,
    instanceId: job.instanceId,
    templateId: job.templateId,
    agentName,
    sessionKey: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
  return runId;
}

/**
 * The Agent's Sources still `processing` whose Template declares an enrichment:
 * written, and waiting for their external job to be handed off. Includes Sources
 * put back to `processing` by a manual retry.
 */
async function listAwaitingEnrichment(ctx: QueryCtx, instanceId: string, templateId: string) {
  const processing = await ctx.db
    .query("sources")
    .withIndex("by_instance_template_status", (q) =>
      q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", "processing"),
    )
    .take(AWAITING_ENRICHMENT_LIMIT);
  const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
  return processing.filter((s) => templateHasEnrichment(template, s.sourceId));
}

/**
 * Cron entry: starts one execution for each due `active` job. A job whose
 * previous execution is still in flight is skipped (reported as `skipped`)
 * and its next run advances.
 */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [activeDue, manualDue] = await Promise.all([
      ctx.db
      .query("jobs")
      .withIndex("by_type_state_nextRun", (q) => q.eq("type", "source_ingestion").eq("state", "active").lte("nextRunAt", now))
      .take(100),
      ctx.db
        .query("jobs")
        .withIndex("by_type_runNowAt", (q) => q.eq("type", "source_ingestion").gte("runNowAt", 0).lte("runNowAt", now))
        .take(100),
    ]);
    const due = [...new Map([...activeDue, ...manualDue].map((job) => [job._id, job])).values()];

    for (const row of due.filter((job) => job.type === "source_ingestion")) {
      const job = asSourceJob(row);
      const manualRun = row.runNowAt !== undefined || job.runNowRequestedAt !== undefined;
      const restorePaused = job.runNowRestorePaused === true;
      if (job.state === "paused" && !manualRun) continue;
      const nextRunAt = computeNextRunAt(frequencyOf(job), job.timezone, now);

      if (job.inFlightRunId) {
        const inFlight = await ctx.db.get(job.inFlightRunId);
        if (inFlight && IN_FLIGHT_RUN_STATUSES.has(inFlight.status)) {
          await patchSourceRuntime(ctx, row, {}, { lastOutcome: "skipped", nextRunAt });
          continue;
        }
        // Terminal (or gone) yet never settled: nothing is in flight anymore.
        await patchSourceRuntime(ctx, row, CLEARED_IN_FLIGHT);
      }

      const agent = await ctx.db
        .query("projectAgents")
        .withIndex("by_instance_template", (q) =>
          q.eq("instanceId", job.instanceId).eq("templateId", job.templateId),
        )
        .unique();
      if (!agent || agent.status !== "active" || !agent.openclawAgentName) {
        await patchSourceRuntime(ctx, row, { runNowRequestedAt: undefined, runNowRestorePaused: undefined }, {
          runNowAt: undefined,
          ...(restorePaused ? { state: "paused" } : {}),
          lastOutcome: "failed",
          lastError: "Agent is not active",
          lastRunAt: now,
          nextRunAt,
        });
        continue;
      }

      await startExecution(ctx, job, agent.openclawAgentName, now, nextRunAt);
      if (manualRun) {
        const started = await ctx.db.get(job._id);
        if (started) await patchSourceRuntime(ctx, started, { runNowRequestedAt: undefined, runNowRestorePaused: undefined }, { runNowAt: undefined, ...(restorePaused ? { state: "paused" } : {}) });
      }
    }
  },
});

/** Builds the batch and starts one execution Run of a job that has nothing in flight. */
async function startExecution(
  ctx: MutationCtx,
  job: SourceJob,
  agentName: string,
  now: number,
  nextRunAt: number,
) {
  const batch = await buildBatch(ctx, job, now);
  const runId = await insertExecutionRun(ctx, job, agentName, now);
  await patchSourceRuntime(ctx, job, { ...CLEARED_IN_FLIGHT, inFlightRunId: runId, inFlightBatch: batch }, {
    lastRunAt: now,
    nextRunAt,
    latestRunId: runId,
  });
}

/**
 * A SourceJob execution reached a terminal outcome (called from `runs.ts`).
 * Success advances the cursor to the batch's bound and clears the retry flags
 * of the Sources that were in it; failure keeps the cursor and records why.
 */
export type SourceJobOutcome =
  | { ok: true; /** Work remains (Sources over the cap): the batch is rebuilt next time. */ keepCursor?: boolean }
  // `feedback`: the result was invalid (Sources or file); the job resumes the
  // Agent with the errors while tries remain (#567), and fails with `error` after.
  | { ok: false; error: string; feedback?: TryFeedback };

/**
 * Deletes the job's run file and the result file of every execution of the
 * settling chain, through one background workspace command (queued in the settling transaction). Missing files are
 * fine (an execution that never wrote its result). Best effort: a failed
 * delete never blocks the job from settling.
 */
async function scheduleRunFilesCleanup(
  ctx: MutationCtx,
  job: SourceJob,
  settlingRunId: Id<"runs">,
): Promise<void> {
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", job.instanceId).eq("templateId", job.templateId))
    .unique();
  if (!agent?.workspaceKey) return;

  const filePaths = [jobRunFilePath(job._id)];
  const seen = new Set<Id<"runs">>();
  let cursor: Id<"runs"> | undefined = settlingRunId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    filePaths.push(jobResultFilePath(job._id, cursor));
    cursor = (await ctx.db.get(cursor))?.resumedFromRunId;
  }
  await enqueueCommand(ctx, {
    instanceId: job.instanceId,
    type: RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
    payload: { workspaceKey: agent.workspaceKey, filePaths },
  });
}

/**
 * Chains a new execution after one whose result was invalid: the failed Run
 * keeps the errors (plus the entries accepted so far, so a resent entry is
 * never inserted twice) on its `intermediateResult`, and the new Run is
 * dispatched at once. An enrichment the failed execution was resumed from is
 * carried along, since the fresh session knows nothing of it.
 */
async function resumeWithFeedback(
  ctx: MutationCtx,
  job: SourceJob,
  failedRunId: Id<"runs">,
  feedback: TryFeedback,
  tries: number,
  now: number,
): Promise<void> {
  const failed = await ctx.db.get(failedRunId);
  if (!failed) return;
  const predecessor = failed.resumedFromRunId ? await ctx.db.get(failed.resumedFromRunId) : null;
  const before = feedbackOf(predecessor?.intermediateResult);
  const enrichment = predecessor?.intermediateResult as { sourceRef?: Id<"sources"> } | undefined;
  await ctx.db.patch(failedRunId, {
    intermediateResult: {
      ...(enrichment?.sourceRef ? enrichment : {}),
      feedback: {
        errors: feedback.errors,
        accepted: [...new Set([...(before?.accepted ?? []), ...(feedback.accepted ?? [])])],
        surplus: before?.surplus === true || feedback.surplus === true,
      },
    },
  });
  const resumedRunId = await insertExecutionRun(ctx, job, failed.agentName, now, failedRunId);
  await patchSourceRuntime(ctx, job, { inFlightRunId: resumedRunId, inFlightTries: tries });
}

export async function settleSourceJobRun(
  ctx: MutationCtx,
  run: RunParentRecord & Pick<Doc<"runs">, "agentName">,
  requested: SourceJobOutcome,
): Promise<void> {
  const parent = runParent(run);
  if (parent.kind !== "job") return;
  const row = await ctx.db.get(parent.jobId);
  if (!row || row.type !== "source_ingestion") return;
  const job = asSourceJob(row);
  if (job.inFlightRunId !== run._id) return;
  const now = Date.now();
  let outcome = requested;

  // An invalid result with tries left: the job stays in flight and a resumed
  // execution receives the errors (its files stay until the job settles).
  if (!outcome.ok && outcome.feedback) {
    const tries = (job.inFlightTries ?? 0) + 1;
    if (tries < MAX_SOURCE_TRIES) {
      await resumeWithFeedback(ctx, job, run._id, outcome.feedback, tries, now);
      return;
    }
  }

  // An execution hands off one enrichment; Sources still awaiting theirs get a
  // follow-up execution, one at a time, within a bound (#579). Stop and
  // failures never reach here (`ok: false`), so they end the chain. Neither does
  // a surplus result (`keepCursor`): the cursor has not moved, so the next tick
  // rebuilds the batch and its run file lists these Sources again.
  if (outcome.ok && !outcome.keepCursor && (await listAwaitingEnrichment(ctx, job.instanceId, job.templateId)).length > 0) {
    const chained = (job.inFlightChained ?? 0) + 1;
    if (chained <= MAX_CHAINED_EXECUTIONS) {
      const chainedRunId = await insertExecutionRun(ctx, job, run.agentName, now, run._id);
      await patchSourceRuntime(ctx, row, { inFlightRunId: chainedRunId, inFlightChained: chained });
      return;
    }
    outcome = {
      ok: false,
      error: `Stopped after ${MAX_CHAINED_EXECUTIONS} chained executions: Sources are still awaiting enrichment`,
    };
  }

  // The job is settled (success, failure or cancellation): its files leave the
  // Agent's workspace. Debugging goes through Convex and Agent Logs.
  await scheduleRunFilesCleanup(ctx, job, run._id);

  if (!outcome.ok) {
    const exhausted = outcome.feedback ? `Still invalid after ${MAX_SOURCE_TRIES} tries. ` : "";
    await patchSourceRuntime(ctx, row, {
      ...CLEARED_IN_FLIGHT,
    }, {
      lastOutcome: "failed",
      lastError: `${exhausted}${outcome.error}`,
    });
    return;
  }

  if (!outcome.keepCursor) {
    for (const sourceId of job.inFlightBatch?.retrySourceIds ?? []) {
      await ctx.db.patch(sourceId, { retryRequested: undefined });
    }
  }
  await patchSourceRuntime(ctx, row, {
    cursorAt: outcome.keepCursor ? job.cursorAt : (job.inFlightBatch?.boundAt ?? job.cursorAt),
    ...CLEARED_IN_FLIGHT,
  }, {
    lastOutcome: "succeeded",
    lastError: undefined,
  });
}

/**
 * A polled enrichment reached a terminal state (issue #533): the execution that
 * handed it off ends `resumed` and the SourceJob goes on.
 *
 * - `completed`: the same SourceJob resumes with a new execution that receives
 *   the job's output (through this Run's `intermediateResult`) and completes
 *   the Source through the validated route.
 * - `failed`: the Source becomes `failed` (retryable) or `unavailable` (never
 *   retryable). That does not fail the job (its batch was ingested): it goes on
 *   with a new execution when another Source still awaits its handoff, and is
 *   otherwise reported succeeded right here.
 *
 * The job stays in flight throughout — `inFlightRunId` moves to the resumed
 * execution in the same transaction — and only ever succeeds when an execution
 * ends without a further handoff (`settleSourceJobRun`, from `runs.markCompleted`).
 */
export const resumeAfterEnrichment = internalMutation({
  args: {
    runId: v.id("runs"),
    sourceRef: v.id("sources"),
    jobType: v.optional(v.string()),
    outcome: v.union(
      v.object({ kind: v.literal("completed"), output: v.record(v.string(), v.any()) }),
      v.object({
        kind: v.literal("failed"),
        sourceStatus: v.union(v.literal("failed"), v.literal("unavailable")),
        message: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    // A Stop or a timeout may have ended the Run since it was polled.
    if (!run) return null;
    const jobRun = run as typeof run & { jobId?: Id<"jobs"> };
    if (run.status !== "awaiting_job" || !jobRun.jobId) return null;
    const now = Date.now();
    const { outcome } = args;

    // What the handoff stored (accepted entries, Sources left over the cap, #568)
    // must survive into the resumed execution.
    const carried = feedbackOf(run.intermediateResult);
    await ctx.db.patch(run._id, {
      status: "resumed",
      completedAt: now,
      updatedAt: now,
      intermediateResult: {
        ...(carried ? { feedback: carried } : {}),
        ...(outcome.kind === "completed"
          ? { jobType: args.jobType, sourceRef: args.sourceRef, output: outcome.output }
          : { jobType: args.jobType, sourceRef: args.sourceRef, error: outcome.message, sourceStatus: outcome.sourceStatus }),
      },
    });
    const row = await ctx.db.get(jobRun.jobId);
    if (!row || row.type !== "source_ingestion") return null;
    const job = asSourceJob(row);
    if (job.inFlightRunId !== run._id) return null;

    let mustContinue = outcome.kind === "completed";
    if (outcome.kind === "failed") {
      const source = await ctx.db.get(args.sourceRef);
      // Only a Source still awaiting its enrichment: never reopen a completed one.
      if (source?.status === "processing") await ctx.db.patch(args.sourceRef, { status: outcome.sourceStatus });
      mustContinue = (await listAwaitingEnrichment(ctx, run.instanceId, run.templateId)).length > 0;
    }

    if (!mustContinue) {
      await settleSourceJobRun(ctx, run, { ok: true });
      return null;
    }
    const resumes = (job.inFlightResumes ?? 0) + 1;
    if (resumes > MAX_ENRICHMENT_RESUMES) {
      await settleSourceJobRun(ctx, run, {
        ok: false,
        error: `Stopped after ${MAX_ENRICHMENT_RESUMES} enrichment handoffs in one run`,
      });
      return null;
    }
    const resumedRunId = await insertExecutionRun(ctx, job, run.agentName, now, run._id);
    await patchSourceRuntime(ctx, row, { inFlightRunId: resumedRunId, inFlightResumes: resumes });
    return { resumedRunId };
  },
});

/** What the dispatcher needs to launch a SourceJob execution Run. */
export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const jobRun = run as typeof run & { jobId?: Id<"jobs"> };
    if (!jobRun.jobId) return null;
    const row = await ctx.db.get(jobRun.jobId);
    if (!row || row.type !== "source_ingestion") return null;
    const job = asSourceJob(row);
    if (job.inFlightRunId !== run._id || !job.inFlightBatch) return null;
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", run.instanceId).eq("templateId", run.templateId),
      )
      .unique();
    if (!agent?.workspaceKey) return null;

    const retrySources = (
      await Promise.all(
        job.inFlightBatch.retrySourceIds.map(async (id) => {
          const source = await ctx.db.get(id);
          return source ? { id, sourceId: source.sourceId } : null;
        }),
      )
    ).filter((s) => s !== null);

    // A resumed execution (issue #533) receives what the enrichment it resumes
    // from ended with, kept on that Run's `intermediateResult`.
    let enrichment: {
      sourceRef: Id<"sources">;
      sourceId: string;
      jobType?: string;
      output?: Record<string, unknown>;
      error?: string;
      sourceStatus?: string;
      stored?: { origin: string; capturedAt: number; marketing: unknown; analysis: unknown };
    } | null = null;
    // A retry after an invalid result (#567) also receives the errors of the try it follows.
    let feedback: ReturnType<typeof feedbackOf>;
    if (run.resumedFromRunId) {
      const previous = await ctx.db.get(run.resumedFromRunId);
      feedback = feedbackOf(previous?.intermediateResult);
      const result = previous?.intermediateResult as
        | { sourceRef?: Id<"sources">; jobType?: string; output?: Record<string, unknown>; error?: string; sourceStatus?: string }
        | undefined;
      const source = result?.sourceRef ? await ctx.db.get(result.sourceRef) : null;
      if (result?.sourceRef && source) {
        enrichment = {
          sourceRef: result.sourceRef,
          sourceId: source.sourceId,
          jobType: result.jobType,
          output: result.output,
          error: result.error,
          sourceStatus: result.sourceStatus,
          ...(source.status === "processing"
            ? { stored: { origin: source.origin, capturedAt: source.capturedAt, marketing: source.marketing, analysis: source.analysis } }
            : {}),
        };
      }
    }
    const awaitingEnrichment = (await listAwaitingEnrichment(ctx, run.instanceId, run.templateId))
      .filter((s) => s._id !== enrichment?.sourceRef)
      .map((s) => ({ id: s._id, sourceId: s.sourceId, origin: s.origin }));

    const batchRuns = await Promise.all(job.inFlightBatch.runIds.map((id) => ctx.db.get(id)));
    const batchRunMissionIds: Record<string, string> = {};
    for (const batchRun of batchRuns) {
      if (batchRun?.missionId) batchRunMissionIds[batchRun._id] = batchRun.missionId;
    }

    return {
      run: { _id: run._id, agentName: run.agentName, sessionKey: run.sessionKey },
      workspaceKey: agent.workspaceKey,
      instanceId: run.instanceId,
      templateId: run.templateId,
      // Resumed after an enrichment: its batch was already ingested. A pure
      // retry with feedback keeps its batch, its fresh session has no memory of it.
      resumed: run.resumedFromRunId !== undefined && (feedback === undefined || enrichment !== null),
      feedbackErrors: feedback?.errors,
      enrichment,
      awaitingEnrichment,
      batch: {
        runIds: job.inFlightBatch.runIds,
        runMissionIds: batchRunMissionIds,
        retrySources,
        cursorAt: job.cursorAt,
        boundAt: job.inFlightBatch.boundAt,
      },
    };
  },
});

/** Identifies the generic Job capability handled by the Source pipeline. */
export const isSourceIngestionRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return false;
    const jobRun = run as typeof run & { jobId?: Id<"jobs"> };
    if (!jobRun.jobId) return false;
    return (await ctx.db.get(jobRun.jobId))?.type === "source_ingestion";
  },
});

// --- Jobs page (issue #534) -------------------------------------------------


function assertValidFrequency(f: Frequency): void {
  const inRange = (n: number | undefined, min: number, max: number) =>
    n !== undefined && Number.isInteger(n) && n >= min && n <= max;
  if (!inRange(f.hour, 0, 23) || !inRange(f.minute, 0, 59)) throw new Error("Invalid time of day");
  if (f.unit === "weekly" && !inRange(f.dayOfWeek, 0, 6)) throw new Error("Invalid day of week");
  if (f.unit === "monthly" && !inRange(f.dayOfMonth, 1, 31)) throw new Error("Invalid day of month");
}

async function loadOwnedJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job || job.type !== "source_ingestion") throw new Error("Forbidden");
  await requireOwnedRow(ctx, job);
  return job;
}

/**
 * The SourceJobs of a Project's Agents for the Jobs page, ownership-scoped
 * (`[]` for a stranger). The execution internals (batch, resume counter) stay
 * server-side; `running` says an execution is in flight.
 */
export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_instance_owner", (q) => q.eq("instanceId", args.instanceId).eq("ownerId", ownerId))
      .take(100);
    return await Promise.all(
      jobs
        .filter((job) => job.type === "source_ingestion")
        .map(async (job) => {
          const sourceJob = asSourceJob(job);
          // A run that ended without settling the job leaves `inFlightRunId` set:
          // report `running` from the Run's real status so the job can be re-run.
          const inFlightRun = sourceJob.inFlightRunId ? await ctx.db.get(sourceJob.inFlightRunId) : null;
          const latestRun = await ctx.db
            .query("runs")
            .withIndex("by_job", (q) => q.eq("jobId", job._id))
            .order("desc")
            .first();
          const agent = await ctx.db
            .query("projectAgents")
            .withIndex("by_instance_template", (q) =>
              q.eq("instanceId", job.instanceId).eq("templateId", job.templateId),
            )
            .unique();
          return {
            _id: job._id,
            templateId: job.templateId,
            agentName: agent?.openclawAgentName ?? openClawAgentSlug(job.templateId),
            // Deep link to the job's latest Run in Agent Logs (#565): both are
            // client-safe domain ids, never the session identifier.
            workspaceKey: agent?.workspaceKey,
            latestRunId: latestRun?._id,
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
            running: inFlightRun !== null && IN_FLIGHT_RUN_STATUSES.has(inFlightRun.status),
          };
        }),
    );
  },
});

/** Sets the recurrence; the next run is recomputed from now (no catch-up). */
export const setFrequency = mutation({
  args: { jobId: v.id("jobs"), frequency: frequencyV, timezone: v.string() },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const frequency: Frequency = args.frequency;
    assertValidFrequency(frequency);
    const now = Date.now();
    const nextRunAt = computeNextRunAt(frequency, args.timezone, now);
    await ctx.db.patch(job._id, {
      unit: frequency.unit,
      // Explicit undefined clears a day left over from another unit.
      dayOfWeek: frequency.unit === "weekly" ? frequency.dayOfWeek : undefined,
      dayOfMonth: frequency.unit === "monthly" ? frequency.dayOfMonth : undefined,
      hour: frequency.hour,
      minute: frequency.minute,
      timezone: args.timezone,
      nextRunAt,
      updatedAt: now,
    });
  },
});

export const pause = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    await ctx.db.patch(job._id, { state: "paused", updatedAt: Date.now() });
  },
});

/** Resumes with a fresh next run; the cursor is kept, so the paused period is in the next batch. */
export const resume = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "active",
      nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now),
      updatedAt: now,
    });
  },
});

/**
 * Starts an execution now, whatever the schedule (or a pause). The recurrence is
 * untouched: `nextRunAt` stays where it was, the cursor advances on success as usual.
 */
export const runNow = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await loadOwnedJob(ctx, args.jobId);
    const sourceJob = asSourceJob(job);
    if (sourceJob.inFlightRunId) {
      const inFlight = await ctx.db.get(sourceJob.inFlightRunId);
      if (inFlight && IN_FLIGHT_RUN_STATUSES.has(inFlight.status)) {
        throw new Error("This job is already running.");
      }
      // Terminal (or gone) yet never settled: nothing is in flight anymore.
      await patchSourceRuntime(ctx, job, CLEARED_IN_FLIGHT);
    }
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", job.instanceId).eq("templateId", job.templateId),
      )
      .unique();
    if (!agent || agent.status !== "active" || !agent.openclawAgentName) {
      throw new Error("The Agent is not active.");
    }
    await startExecution(ctx, sourceJob, agent.openclawAgentName, Date.now(), job.nextRunAt);
  },
});

/**
 * One-off repair: normalizes the `ownerId` of jobs created with the token
 * identifier, and creates the missing job of every `active` Agent whose Template
 * declares Sources (Agents activated before SourceJobs existed).
 */
export const repairJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    let normalized = 0;
    for (const job of await ctx.db.query("jobs").collect()) {
      if (job.type !== "source_ingestion") continue;
      const ownerId = ownerSubjectOf(job.ownerId);
      if (ownerId !== job.ownerId) {
        await ctx.db.patch(job._id, { ownerId });
        normalized++;
      }
    }
    let created = 0;
    for (const agent of await ctx.db.query("projectAgents").collect()) {
      if (agent.status !== "active") continue;
      if (await findJob(ctx, agent.instanceId, agent.templateId)) continue;
      if (await insertSourceIngestionJobForAgent(ctx, agent, Date.now())) created++;
    }
    return { normalized, created };
  },
});
