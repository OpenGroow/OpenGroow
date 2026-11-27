import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { computeNextRunAt, frequencyOf } from "./schedules/frequency.js";
import { newRunBlock } from "./template_runnable.js";

/**
 * A Job tick asks this before it starts anything (ADR-091). When the Job's Template version is outdated the pass is
 * skipped without a Run and without an error: a queued Run Now is consumed, the Job keeps its state (a Run Now on a
 * paused Job restores the pause) and its next scheduled occurrence moves on, so it resumes by itself after the update.
 * Returns whether the Job was skipped.
 */
export async function skipJobOnOutdatedTemplate(ctx: MutationCtx, job: Doc<"jobs">, now: number): Promise<boolean> {
  if (!(await newRunBlock(ctx, job.instanceId, job.templateId))) return false;
  const runtime = (job.runtime ?? {}) as Record<string, unknown>;
  const { runNowRequestedAt: _requested, runNowRestorePaused: _restore, ...rest } = runtime;
  await ctx.db.patch(job._id, {
    runNowAt: undefined,
    runtime: rest,
    ...(runtime.runNowRestorePaused === true ? { state: "paused" as const } : { nextRunAt: computeNextRunAt(frequencyOf(job), job.timezone, now) }),
    lastOutcome: "skipped",
    lastError: undefined,
    updatedAt: now,
  });
  return true;
}
