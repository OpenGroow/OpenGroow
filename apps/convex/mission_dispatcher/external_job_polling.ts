import type {
  ExternalJobPollingContract,
  ExternalJobPollingCore,
  SourceExternalJobPollingContract,
} from "@opengroow/agent-templates";
import { decideBoundedRetry, isRetryDecision } from "@opengroow/reliability";
import type { RunResult } from "../run_result.js";

export type ExternalJobStatus = {
  status: string;
  error?: string;
  output?: Record<string, unknown>;
};

/**
 * Cap on how many times a single Mission may be resumed after a retryable
 * External Job failure (`onFail: "resume_mission"`). Once reached, a further
 * declared-failed status falls back to a normal `markFailed`, so an Agent
 * that keeps repeating the same mistake (e.g. an over-length Letter title)
 * cannot loop forever.
 */
export const MAX_RETRYABLE_JOB_FAILURES = 3;

/**
 * Whether a declared-failed job's error text describes a client error (4xx —
 * e.g. the Letter service's 400 on an over-length title) that the Agent can
 * plausibly fix by changing its next Manifest, as opposed to a server error
 * (5xx — the external service is broken, retrying with the same Manifest
 * changes nothing) or an error whose HTTP status can't be determined at all.
 *
 * The distinction matters because `onFail: "resume_mission"` only makes sense
 * for errors the Agent has a real chance of correcting: a 5xx (or an
 * unparseable message) always falls back to a terminal `markFailed`
 * regardless of what the contract declares, so the Mission doesn't loop
 * uselessly through Runs against a service that's simply down. Conservative
 * by construction — no code found is treated as *not* retryable, matching
 * the pre-existing terminal-failure default for anything we can't positively
 * classify as agent-fixable.
 */
export function classifyRetryableFailure(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const match = /\b([1-5]\d{2})\b/.exec(errorMessage);
  if (!match) return false;
  const code = Number(match[1]);
  return code >= 400 && code < 500;
}

export type PollDecision =
  | { type: "wait" }
  | { type: "markFailed"; code: string; message: string }
  // A declared-failed terminal state, but the contract opts into `onFail:
  // "resume_mission"`, the Mission hasn't exhausted its retry budget
  // (MAX_RETRYABLE_JOB_FAILURES), AND the error looks agent-fixable
  // (classifyRetryableFailure — a 4xx, not a 5xx or an unclassifiable
  // message): reuses the same "resume with an Intermediate Result"
  // mechanism as `markResumed` above, but for a failure — a fresh Run is
  // dispatched with the error injected into context.md so the Agent can
  // correct its Manifest and retry.
  | {
      type: "markFailedRetryable";
      jobType: string | undefined;
      error: string;
      details: Record<string, unknown> | undefined;
    }
  | { type: "markCompleted"; result: RunResult }
  // An Intermediate External Job (ADR-026) completed: no terminal RunResult,
  // no Artifact. `intermediateResult` is the job's raw `output`, forwarded
  // as-is; `jobType` names which job produced it so the Mission context can
  // say where it came from.
  // `jobType` is optional only because it's forwarded from a legacy Run's
  // `mcpJob.jobType` (pre-#243 documents may lack it, see schema.ts); it is
  // never involved in resolving the Template's `ExternalJobPollingContract`
  // (that lookup is keyed by mission type only, see
  // `resolveExternalJobContract` in @opengroow/agent-templates), so an
  // undefined `jobType` here has no effect beyond the label being absent.
  | { type: "markResumed"; intermediateResult: Record<string, unknown>; jobType: string | undefined };

/**
 * The polling engine's shared state machine (Mission External Jobs and Source
 * enrichment, issue #533): what one polled status means against the declared
 * polling core, before either caller decides what a completion or a failure
 * means for its own subject. Pure.
 */
export type JobPollState = "completed" | "failed" | "malformed" | "timedOut" | "wait";

export function classifyJobPoll(
  job: ExternalJobStatus,
  core: Pick<ExternalJobPollingCore, "terminalStates">,
  timedOut: boolean,
): JobPollState {
  if (core.terminalStates.completed.includes(job.status)) return "completed";
  if (core.terminalStates.failed.includes(job.status)) return "failed";
  if (job.status === "") return "malformed";
  return timedOut ? "timedOut" : "wait";
}

/**
 * Decide the next step for an `awaiting_job` Run given the External Job's
 * latest polled status and the Template's declared polling contract. Pure —
 * no MCP call, no Convex ctx. `fetchExternalJobStatusFromEndpoint` (the I/O) and
 * `resolveExternalJobContract` (the Template lookup) stay in the caller;
 * this is only the branch that used to be inlined after both were resolved.
 *
 * This is the state machine `pollExternalJobs` walks every tick: status
 * matches the contract's `completed` list → complete (with the declared
 * `resultIdField` or the job id as the Artifact's `external.id`); status
 * matches `failed` → fail with the job's own error; empty/missing status →
 * a malformed response, fail; still running → wait, unless the Run has
 * outlived its timeout budget.
 */
export function decideExternalJobPoll(
  job: ExternalJobStatus,
  contract: ExternalJobPollingContract,
  ctx: {
    serverName: string;
    jobId: string;
    summary: string;
    reviewQuestions: string[];
    maxMs: number;
    jobType: string | undefined;
    /**
     * How many times this Mission has already been resumed after a retryable
     * External Job failure. Optional — defaults to 0 — so existing callers
     * that never exercise `onFail: "resume_mission"` don't need to thread it
     * through.
     */
    retryableFailureCount?: number;
  },
  timedOut: boolean,
): PollDecision {
  const state = classifyJobPoll(job, contract, timedOut);
  if (state === "completed") {
    // Intermediate External Job (ADR-026): completion never produces a
    // terminal RunResult/Artifact here — it resumes the Mission with the
    // job's raw output as an Intermediate Result. This only changes the
    // *completed* path; `terminalStates.failed` below still always fails.
    if (contract.onComplete === "resume_mission") {
      return {
        type: "markResumed",
        intermediateResult: job.output ?? {},
        jobType: ctx.jobType,
      };
    }

    let artifactId: string;
    if (contract.resultIdField !== undefined) {
      const rawId = job.output !== undefined ? job.output[contract.resultIdField] : undefined;
      if (rawId === undefined || rawId === null) {
        return {
          type: "markFailed",
          code: "external_job_poll_failed",
          message: `External job completed but output is missing declared resultIdField "${contract.resultIdField}"`,
        };
      }
      artifactId = String(rawId);
    } else {
      artifactId = ctx.jobId;
    }

    const artifact = {
      kind: contract.artifactKind,
      external: { service: ctx.serverName, id: artifactId },
      metadata: {},
    };

    return {
      type: "markCompleted",
      result:
        contract.resultStatus === "needs_human_review"
          ? {
              status: "needs_human_review",
              summary: ctx.summary,
              reviewQuestions: ctx.reviewQuestions,
              artifact,
            }
          : { status: "success", summary: ctx.summary, artifact },
    };
  }

  if (state === "failed") {
    if (contract.onFail === "resume_mission" && classifyRetryableFailure(job.error)) {
      // Bookkeeping (counter vs. MAX_RETRYABLE_JOB_FAILURES bound) folds
      // through the shared bounded-retry primitive (ADR-033) — this call
      // site's own predicate is "the contract opts in and the error is
      // agent-fixable" (checked above), and its own terminal meaning is "fall
      // back to a normal, non-retryable markFailed".
      const decision = decideBoundedRetry(
        { attempts: ctx.retryableFailureCount ?? 0 },
        { maxAttempts: MAX_RETRYABLE_JOB_FAILURES },
      );
      if (isRetryDecision(decision)) {
        return {
          type: "markFailedRetryable",
          jobType: ctx.jobType,
          error: job.error ?? `External job status: ${job.status}`,
          details: job.output,
        };
      }
    }
    return {
      type: "markFailed",
      code: "external_job_failed",
      message: job.error ?? `External job status: ${job.status}`,
    };
  }

  if (state === "malformed") {
    return {
      type: "markFailed",
      code: "external_job_poll_failed",
      message: `External job poll returned malformed status (statusField "${contract.statusField}" missing or not a string)`,
    };
  }

  if (state === "timedOut") {
    return { type: "markFailed", code: "timeout", message: `Run exceeded ${ctx.maxMs} ms` };
  }

  // Otherwise still in progress: leave it for the next tick.
  return { type: "wait" };
}

export type SourceEnrichmentPollDecision =
  | { type: "wait" }
  // The job finished: its output goes to a resumed SourceJob execution, which
  // normalizes it and completes the Source through the validated route.
  | { type: "completed"; output: Record<string, unknown> }
  // The Source ends `failed` (retryable) or `unavailable` (never retryable).
  | { type: "failed"; sourceStatus: "failed" | "unavailable"; message: string };

/**
 * Decide the next step for the external job enriching a Source (issue #533,
 * ADR-051). Same engine as `decideExternalJobPoll` (`classifyJobPoll`); only
 * what a terminal state means differs. Pure.
 *
 * - completed with a result -> `completed`; completed with nothing to analyze
 *   (no or empty output) -> `unavailable`: the result is structurally
 *   unanalyzable, retrying the same job cannot help.
 * - declared-failed -> `unavailable` when the job's error code is one the
 *   contract lists in `unavailableErrorCodes`, `failed` otherwise.
 * - malformed status or timeout -> `failed` (transient by nature: retryable).
 */
export function decideSourceEnrichmentPoll(
  job: ExternalJobStatus,
  contract: Pick<SourceExternalJobPollingContract, "terminalStates" | "unavailableErrorCodes">,
  ctx: { maxMs: number },
  timedOut: boolean,
): SourceEnrichmentPollDecision {
  switch (classifyJobPoll(job, contract, timedOut)) {
    case "wait":
      return { type: "wait" };
    case "completed":
      if (!job.output || Object.keys(job.output).length === 0) {
        return {
          type: "failed",
          sourceStatus: "unavailable",
          message: "External job completed with no result to analyze",
        };
      }
      return { type: "completed", output: job.output };
    case "failed": {
      const errorCode = typeof job.output?.errorCode === "string" ? job.output.errorCode : undefined;
      const unavailable = errorCode !== undefined && contract.unavailableErrorCodes?.includes(errorCode) === true;
      return {
        type: "failed",
        sourceStatus: unavailable ? "unavailable" : "failed",
        message: job.error ?? `External job status: ${job.status}`,
      };
    }
    case "malformed":
      return { type: "failed", sourceStatus: "failed", message: "External job poll returned a malformed status" };
    case "timedOut":
      return { type: "failed", sourceStatus: "failed", message: `Enrichment exceeded ${ctx.maxMs} ms` };
  }
}
