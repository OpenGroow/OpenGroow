import type { Id } from "./_generated/dataModel";

/**
 * What a Run is attached to: exactly one of a Mission or generic Job. The
 * table stores the parent as optional ids; this is the only
 * place that turns them into a single value, so a reader never re-derives
 * "Mission-less" from a missing field.
 */
export type RunParent =
  | { kind: "mission"; missionId: Id<"missions"> }
  | { kind: "job"; jobId: Id<"jobs"> }
  // A Standalone Run (ADR-087): neither, carried by its `recipeGeneration` pin.
  | { kind: "standalone"; runId: Id<"runs"> };

export type RunParentRecord = {
  _id: Id<"runs">;
  missionId?: unknown;
  jobId?: unknown;
  recipeGeneration?: unknown;
};

/** The Mission id of a Mission's Run; undefined for a Job's Run. */
export function parentMissionId(parent: RunParent): Id<"missions"> | undefined {
  return parent.kind === "mission" ? parent.missionId : undefined;
}

export function runParent(
  run: RunParentRecord,
): RunParent {
  const missionId = run.missionId as Id<"missions"> | null | undefined;
  const jobId = run.jobId as Id<"jobs"> | null | undefined;
  // The `runs` table union makes both-or-neither unwritable; these guards only
  // cover a row that predates it or a hand-built value.
  if (missionId && jobId) {
    throw new Error(`Run ${run._id} is attached to both a Mission and a Job`);
  }
  if (run.recipeGeneration) {
    if (missionId || jobId) {
      throw new Error(`Run ${run._id} is a Standalone Run but is attached to both a Mission or a Job and a pin`);
    }
    return { kind: "standalone", runId: run._id };
  }
  if (missionId) return { kind: "mission", missionId };
  if (jobId) return { kind: "job", jobId };
  throw new Error(`Run ${run._id} is attached to neither a Mission nor a Job`);
}
