import type { Doc } from "./_generated/dataModel.js";

// What the modules of the `content_planning` Job type (ADR-086) share: its type name, the tries budget and how the
// Job's `runtime` bag is read.

export const CONTENT_PLANNING_JOB_TYPE = "content_planning" as const;

/** Tries of one Content Planning execution: the first Run and its retries. */
export const MAX_CONTENT_PLANNING_TRIES = 3;

/** Everything a Content Planning Run depends on, pinned on the Run when it starts (`run.contentPlanning`). */
export type ContentPlanningPins = NonNullable<Doc<"runs">["contentPlanning"]>;

export type Runtime = Record<string, unknown>;

export function runtimeOf(job: Doc<"jobs">): Runtime {
  return job.runtime && typeof job.runtime === "object" && !Array.isArray(job.runtime) ? (job.runtime as Runtime) : {};
}
