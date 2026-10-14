import { decideBoundedRetry, isRetryDecision, isTerminalDecision } from "@opengroow/reliability";
import type { Id } from "../_generated/dataModel.js";
import {
  runResultSchema,
  formatRunResultIssues,
  formatMissingOutputMessage,
  type RunResult,
} from "../run_result.js";
import { MAX_RETRYABLE_JOB_FAILURES } from "./external_job_polling.js";
import type { RunParent } from "../run_parent.js";
import { jobResultFilePath } from "../source_jobs/job_files.js";
import { sourceRunResultSchema } from "../source_jobs/source_run_result.js";

/**
 * The salvage-read last-chance grants exactly one final, fresh read (see
 * ADR-032) before giving up on a stale not-found. Bookkeeping for that single
 * bounded retry is folded through the shared `decideBoundedRetry` primitive
 * (ADR-033) — `finalReadCommandId`'s presence *is* the attempts-used count
 * (0 or 1), so no extra state needs to be threaded through the snapshot.
 */
const SALVAGE_FINAL_READ_MAX_ATTEMPTS = 1;

/**
 * Everything `decideReconciliation` needs to know about a `running` Run to
 * decide its next step. Mirrors the fields `loadReconcileState` (query) and
 * the `dispatchedAt` timeout check already compute — this type carries no
 * new information, it just names the snapshot instead of leaving it as
 * loose locals.
 */
export type ReconcileSnapshot = {
  execResult: { ok: boolean; error?: string } | null;
  resultReadCommandId: Id<"commands"> | null;
  readResult: { ok: boolean; error?: string; data?: { content?: string; found?: boolean } } | null;
  workspaceKey: string | null;
  timedOut: boolean;
  /**
   * True once a salvage read attempted after `timedOut` (see below) has also had long enough to
   * resolve without ever producing a `readResult`. Only consulted while `execResult` is still
   * null; irrelevant once a real `execResult` arrives. Bounds the salvage attempt so a run is
   * still guaranteed to eventually leave `running`, even if the workspace read itself never
   * comes back either.
   */
  salvageTimedOut: boolean;
  /**
   * Set once a last-chance read has been dispatched after `salvageTimedOut`
   * turned true and the cached `readResult` was a stale not-found. Distinct
   * from `resultReadCommandId`/`readResult` so the earlier (possibly stale)
   * cached result is never mistaken for the outcome of this final attempt.
   */
  finalReadCommandId: Id<"commands"> | null;
  finalReadResult: { ok: boolean; error?: string; data?: { content?: string; found?: boolean } } | null;
  /** Only used to phrase the timeout failure message. */
  maxMs: number;
};

export type MissionRunJob = {
  serverName: string;
  jobId: string;
  summary: string;
  reviewQuestions: string[];
  // The MCP tool name the Agent called (ADR-026). Disambiguates which of the
  // Mission type's External Job contracts applies.
  jobType: string;
  missionType: string;
  // Set only by a Source ingestion Job execution (issue #533): the Source being enriched,
  // by id (an already stored one) or, in the handoff result itself (#568), by
  // its position among the result's Sources.
  sourceRef?: string;
  sourcePosition?: number;
};

export type ReconcileDecision =
  | { type: "wait" }
  | { type: "markFailed"; code: string; message: string; retryWithFeedback?: boolean }
  | { type: "enqueueRead"; role: "result" | "final"; filePath: string }
  // `sources` (Source ingestion Job handoff, #568): inserted by Convex while the Run parks;
  // never logged, only the job's `sourcePosition` is.
  | { type: "markAwaitingJob"; job: MissionRunJob; sources?: unknown[] }
  | { type: "markCompleted"; result: RunResult }
  // A Source ingestion Job's success (#564): the Sources of its result file are ingested
  // by Convex while the Run completes. They never enter the decision log.
  | { type: "ingestSources"; result: { status: "success"; summary: string }; sources: unknown[] }
  // The Agent's outputs.json failed the deterministic RunResult contract
  // (invalid JSON, schema mismatch, or an undeclared blockerCode) — an error
  // the Agent itself plausibly wrote and can therefore plausibly fix on a
  // fresh attempt. Reuses the same bounded-retry-with-feedback shape as
  // `PollDecision`'s `markFailedRetryable` (external_job_polling.ts):
  // `jobType` is always `undefined` here since this isn't an External Job.
  | {
      type: "markFailedRetryable";
      jobType: string | undefined;
      error: string;
      details: Record<string, unknown> | undefined;
    };

/**
 * Turns a `file_invalid` outcome into either a bounded retry (fresh Run,
 * error surfaced to the Agent via context.md) or a terminal failure once the
 * Mission's invalid-output retry budget (shared with the External Job
 * `resume_mission` budget, `MAX_RETRYABLE_JOB_FAILURES`) is exhausted.
 */
function decideInvalidOutput(
  message: string,
  ctx: { retryableFailureCount: number; parent: RunParent; sourceIngestion?: boolean; sourceScoring?: boolean; sourceRouting?: boolean },
): ReconcileDecision {
  // A Job has no Mission to resume: the failure is settled on the Job,
  // which resumes its own execution with the error (bounded, #567).
  if (ctx.sourceIngestion === true || ctx.sourceScoring === true || ctx.sourceRouting === true) {
    return { type: "markFailed", code: "file_invalid", message, retryWithFeedback: true };
  }
  const decision = decideBoundedRetry(
    { attempts: ctx.retryableFailureCount },
    { maxAttempts: MAX_RETRYABLE_JOB_FAILURES },
  );
  if (isRetryDecision(decision)) {
    return { type: "markFailedRetryable", jobType: undefined, error: message, details: undefined };
  }
  return { type: "markFailed", code: "file_invalid", message };
}

/**
 * Validates the Agent-supplied blocker code against the Mission type's
 * manifest declaration. `undefined` means the manifest could not be resolved
 * by the caller, so the caller can preserve its existing defensive behavior.
 */
export function validateDeclaredBlockerCode(
  result: RunResult,
  ctx: { missionType: string; blockerCodes?: readonly string[] },
): string | undefined {
  if (result.status !== "blocked_external" || ctx.blockerCodes === undefined) {
    return undefined;
  }
  if (ctx.blockerCodes.includes(result.blockerCode)) {
    return undefined;
  }
  return `blocked_external.blockerCode "${result.blockerCode}" is not declared for Mission type "${ctx.missionType}"`;
}

/**
 * Workspace path where a Run's Agent writes its RunResult. A Mission's Run
 * keeps the historical per-Mission layout; a Job's Run writes under its Job
 * folder (`jobs/<job>/outputs/`, deleted once the Job settles).
 */
export function runOutputsFilePath(parent: RunParent, runId: Id<"runs">): string {
  if (parent.kind === "mission") return `missions/${parent.missionId}/outputs/${runId}.json`;
  return jobResultFilePath(parent.jobId, runId);
}

/**
 * Decide the next step for a `running` Run given a snapshot of what's known
 * so far: whether the openclaw exec finished, whether its outputs file has
 * been read, and what that file contained. Pure — no Convex ctx, no I/O.
 *
 * This is the state machine `reconcileRuns` walks every tick: no exec result
 * yet → wait or time out; exec failed → fail; exec ok and no read dispatched
 * yet → enqueue a read; read dispatched but no result yet → wait; read
 * failed → fail; content invalid JSON/schema → fail; a `RunResult` with
 * `status: "in_progress"` → park as `awaiting_job`; any other valid
 * `RunResult` → complete.
 */
export function decideReconciliation(
  snapshot: ReconcileSnapshot,
  ctx: {
    parent: RunParent;
    sourceIngestion?: boolean;
    sourceScoring?: boolean;
    sourceRouting?: boolean;
    runId: Id<"runs">;
    missionType: string;
    blockerCodes?: readonly string[];
    retryableFailureCount: number;
  },
): ReconcileDecision {
  if (snapshot.execResult && snapshot.execResult.ok === false) {
    return {
      type: "markFailed",
      code: "runtime",
      message: snapshot.execResult.error ?? "openclaw exec failed",
    };
  }

  if (!snapshot.execResult) {
    if (!snapshot.timedOut) return { type: "wait" };
    // Timed out with no exec-completion signal — e.g. the openclaw exec's
    // underlying OS process hung after finishing its work instead of
    // exiting, or the Agent is simply still working past its own session
    // budget (observed live: the openclaw-agent OS process was still
    // actively running well after OpenGroow gave up on it). The Agent may
    // already have written a valid RunResult to the workspace, or may write
    // one shortly, so attempt the same salvage read the exec-ok path below
    // would do rather than discard work in progress.
    if (!snapshot.salvageTimedOut) {
      if (snapshot.resultReadCommandId && snapshot.readResult?.ok === false) {
        // A resolved "not found" this early just means the Agent hasn't
        // written its result yet — not that it never will. Retry instead of
        // treating a single ENOENT as final; only the grace period below
        // gets to make that call.
        if (!snapshot.workspaceKey) {
          return {
            type: "markFailed",
            code: "dispatch_inputs_missing",
            message: "projectAgent.workspaceKey missing during reconcile",
          };
        }
        return {
          type: "enqueueRead",
          role: "result",
          filePath: runOutputsFilePath(ctx.parent, ctx.runId),
        };
      }
      // Otherwise fall through to the shared enqueueRead/readResult handling
      // below: no read dispatched yet, one is in flight, or one already
      // found a (successful) result.
    } else if (snapshot.finalReadCommandId) {
      // Already gave the stale not-found one final, dedicated read — resolve
      // on its outcome instead of the earlier (possibly stale) readResult.
      if (!snapshot.finalReadResult) return { type: "wait" };
      if (snapshot.finalReadResult.ok === false) {
        // One final read was already spent (finalReadCommandId is set) and it
        // still came back not-found — the shared bounded-retry primitive
        // (ADR-033) confirms the one-attempt salvage budget is exhausted.
        const decision = decideBoundedRetry(
          { attempts: 1 },
          { maxAttempts: SALVAGE_FINAL_READ_MAX_ATTEMPTS },
        );
        if (isTerminalDecision(decision)) {
          return {
            type: "markFailed",
            code: "file_missing",
            message: formatMissingOutputMessage(
              runOutputsFilePath(ctx.parent, ctx.runId),
              snapshot.finalReadResult.error,
            ),
          };
        }
      }
      // A genuine success landed on the final read — fall through to the
      // shared content-parsing handling below via `effectiveReadResult`.
    } else if (snapshot.readResult?.ok === false) {
      // The cached readResult straddled the grace-period boundary and may
      // simply be stale — e.g. the Agent's output file appeared moments
      // after this read was taken. Give it exactly one more, final, fresh
      // read before concluding failure — the shared bounded-retry primitive
      // (ADR-033) grants this one salvage attempt; `finalReadCommandId`, set
      // by the caller once this decision is applied, carries the
      // "already used" state so the branch above is what actually checks the
      // bound once this one attempt comes back.
      if (!snapshot.workspaceKey) {
        return {
          type: "markFailed",
          code: "dispatch_inputs_missing",
          message: "projectAgent.workspaceKey missing during reconcile",
        };
      }
      return {
        type: "enqueueRead",
        role: "final",
        filePath: runOutputsFilePath(ctx.parent, ctx.runId),
      };
    } else if (snapshot.resultReadCommandId && !snapshot.readResult) {
      // Give up for good once the salvage read has also had its own bounded
      // grace period without ever resolving.
      return { type: "markFailed", code: "timeout", message: `Run exceeded ${snapshot.maxMs} ms` };
    }
    // salvageTimedOut with a resolved successful readResult falls through to
    // the shared handling below, which reports the precise
    // file_invalid/success outcome now that we're done giving the Agent the
    // benefit of the doubt.
  }

  const effectiveReadResult = snapshot.finalReadResult ?? snapshot.readResult;

  if (!snapshot.resultReadCommandId) {
    // Invariant: workspaceKey is non-null here — dispatch already required it,
    // and a run only reaches `running` after a successful dispatch.
    if (!snapshot.workspaceKey) {
      return {
        type: "markFailed",
        code: "dispatch_inputs_missing",
        message: "projectAgent.workspaceKey missing during reconcile",
      };
    }
    return {
      type: "enqueueRead",
      role: "result",
      filePath: runOutputsFilePath(ctx.parent, ctx.runId),
    };
  }

  if (!effectiveReadResult) return { type: "wait" };

  const outputsPath = runOutputsFilePath(ctx.parent, ctx.runId);

  if (effectiveReadResult.ok === false) {
    return {
      type: "markFailed",
      code: "file_missing",
      message: formatMissingOutputMessage(outputsPath, effectiveReadResult.error),
    };
  }

  const content = effectiveReadResult.data?.content;
  if (typeof content !== "string") {
    return {
      type: "markFailed",
      code: "file_missing",
      message: formatMissingOutputMessage(outputsPath),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return decideInvalidOutput(err instanceof Error ? err.message : "invalid JSON", ctx);
  }

  // A Source ingestion Job's result has its own type.
  if (ctx.sourceIngestion === true) {
    const sourceResult = sourceRunResultSchema.safeParse(parsed);
    if (!sourceResult.success) {
      return decideInvalidOutput(formatRunResultIssues(sourceResult.error, parsed), ctx);
    }
    if (sourceResult.data.status === "failed") {
      return { type: "markCompleted", result: sourceResult.data };
    }
    if (sourceResult.data.status === "in_progress") {
      const { summary, sources, job } = sourceResult.data;
      return {
        type: "markAwaitingJob",
        job: {
          serverName: job.mcpServer,
          jobId: job.jobId,
          summary,
          reviewQuestions: [],
          jobType: job.jobType,
          missionType: ctx.missionType,
          ...(job.sourceRef !== undefined ? { sourceRef: job.sourceRef } : {}),
          ...(job.sourcePosition !== undefined ? { sourcePosition: job.sourcePosition } : {}),
        },
        sources,
      };
    }
    return {
      type: "ingestSources",
      result: { status: "success", summary: sourceResult.data.summary },
      sources: sourceResult.data.sources,
    };
  }

  const validation = runResultSchema.safeParse(parsed);
  if (!validation.success) {
    return decideInvalidOutput(formatRunResultIssues(validation.error, parsed), ctx);
  }

  // The agent dispatched a long-running MCP job and handed back a pointer
  // instead of polling it to completion. Park the run in `awaiting_job`;
  // the separate External Job polling loop takes it from here (issue #138).
  if (validation.data.status === "in_progress") {
    if (ctx.sourceScoring === true || ctx.sourceRouting === true) {
      return decideInvalidOutput(
        `status "in_progress" is not supported for ${ctx.sourceRouting === true ? "Source routing" : "Source scoring"} Job Runs`,
        ctx,
      );
    }
    return {
      type: "markAwaitingJob",
      job: {
        serverName: validation.data.job.mcpServer,
        jobId: validation.data.job.jobId,
        summary: validation.data.summary,
        reviewQuestions: validation.data.reviewQuestions,
        jobType: validation.data.job.jobType,
        missionType: ctx.missionType,
        ...(validation.data.job.sourceRef !== undefined ? { sourceRef: validation.data.job.sourceRef } : {}),
      },
    };
  }

  const blockerError = validateDeclaredBlockerCode(validation.data, ctx);
  if (blockerError) {
    return decideInvalidOutput(blockerError, ctx);
  }

  return { type: "markCompleted", result: validation.data };
}
