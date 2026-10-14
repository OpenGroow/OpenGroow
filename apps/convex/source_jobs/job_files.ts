import type { Id } from "../_generated/dataModel.js";

// A SourceJob's files in the Agent's workspace mirror the Missions' layout
// (`missions/<mission>/…`) under `jobs/<job>/…`. They only exist while the job
// runs (deleted once it settles): debugging goes through Convex and Agent Logs.
// The `sources/` folder holds the Sources' instruction files, and `runs/` reads
// like the Missions' folder, so neither is used.

/** The single file an execution reads: instructions, batch and schemas. */
export function jobRunFilePath(jobId: Id<"jobs">): string {
  return `jobs/${jobId}/run.md`;
}

/** Where an execution's Agent writes its result. */
export function jobResultFilePath(jobId: Id<"jobs">, runId: Id<"runs">): string {
  return `jobs/${jobId}/outputs/${runId}.json`;
}
