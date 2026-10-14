import type { Id } from "../_generated/dataModel.js";
import type { RunParent } from "../run_parent.js";

/** Snapshot consumed by the generic Mission/Job reconciliation loop. */
export type ReconcileRun = {
  _id: Id<"runs">;
  status: string;
  instanceId: string;
  templateId: string;
  parent: RunParent;
  sourceIngestion?: boolean;
  sourceScoring?: boolean;
  sourceRouting?: boolean;
  ownerId: string;
  missionType: string;
  missionPayload?: unknown;
  // The parent Mission's pinned Template version (#651); absent on Missions
  // created before pinning and on Job Runs.
  templateVersion?: string;
  dispatchedAt?: number;
};

/** Extract the Source id carried by a production Mission payload. */
export function sourceIdFromPayload(payload: unknown): Id<"sources"> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = (payload as Record<string, unknown>).observationId;
  return typeof raw === "string" && raw.length > 0 ? (raw as Id<"sources">) : undefined;
}
