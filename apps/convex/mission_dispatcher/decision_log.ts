import { v } from "convex/values";
import { runResultV } from "../run_result.js";

// Historical decision-log rows may contain the pre-#323 blocked_external
// shape. RunResult itself stays strict; this compatibility branch exists only
// because the append-only log must remain deployable while those rows remain
// in Convex.
const legacyBlockedExternalResultV = v.object({
  status: v.literal("blocked_external"),
  summary: v.string(),
  message: v.string(),
  dashboardUrl: v.optional(v.string()),
});

/**
 * Validator for one logged reconciliation decision (issue #237). Mirrors the
 * `ReconcileDecision` / `PollDecision` unions in `reconciliation.ts` and
 * `external_job_polling.ts` — this is the persisted shape of whichever of
 * those a tick applied. Defined once here (rather than inline in
 * `schema.ts`) so `schema.ts` and `mission_dispatcher.ts` share the exact
 * same validator instead of two hand-kept-in-sync copies.
 */
export const reconcileDecisionLogV = v.union(
  v.object({ type: v.literal("wait") }),
  v.object({
    type: v.literal("markFailed"),
    code: v.string(),
    message: v.string(),
    // SourceJob only (#567): the invalid file is fed back to a resumed execution.
    retryWithFeedback: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal("enqueueRead"),
    // Optional for historical rows written before #363. New decisions always
    // carry the role so the persisted decision remains self-descriptive.
    role: v.optional(v.union(v.literal("result"), v.literal("final"))),
    filePath: v.string(),
  }),
  v.object({
    type: v.literal("markAwaitingJob"),
    job: v.object({
      serverName: v.string(),
      jobId: v.string(),
      summary: v.string(),
      reviewQuestions: v.array(v.string()),
      jobType: v.string(),
      missionType: v.string(),
      taskId: v.optional(v.string()),
      sourceRef: v.optional(v.string()),
      // SourceJob handoff (#568): the Source's position in the result file.
      sourcePosition: v.optional(v.number()),
    }),
  }),
  v.object({
    type: v.literal("markCompleted"),
    result: v.union(runResultV, legacyBlockedExternalResultV),
  }),
  // Only the count is logged: the Sources themselves are data, not decisions.
  v.object({
    type: v.literal("ingestSources"),
    result: v.object({ status: v.literal("success"), summary: v.string() }),
    sourceCount: v.number(),
  }),
  v.object({
    type: v.literal("markResumed"),
    intermediateResult: v.record(v.string(), v.any()),
    jobType: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("markFailedRetryable"),
    jobType: v.optional(v.string()),
    error: v.string(),
    details: v.optional(v.record(v.string(), v.any())),
  }),
);
