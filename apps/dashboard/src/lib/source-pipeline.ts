export const SOURCE_PIPELINE_STAGES = ["Ingestion", "Ready", "Scored"] as const;

export type SourcePipelineStage = (typeof SOURCE_PIPELINE_STAGES)[number];
export type SourcePipelineState =
  | { kind: "stage"; current: SourcePipelineStage }
  | { kind: "terminal"; label: "Failed" | "Unavailable" | "Excluded" };

export type SourcePipelineSource = {
  status: "processing" | "ready" | "failed" | "unavailable";
  scoring?: Record<string, number>;
  excluded?: boolean;
};

/** Derives the visible lifecycle from the Source facts, never a stored stage. */
export function deriveSourcePipelineState(source: SourcePipelineSource): SourcePipelineState {
  if (source.excluded === true) return { kind: "terminal", label: "Excluded" };
  if (source.status === "failed") return { kind: "terminal", label: "Failed" };
  if (source.status === "unavailable") return { kind: "terminal", label: "Unavailable" };
  if (source.status === "processing") return { kind: "stage", current: "Ingestion" };
  if (source.scoring === undefined) return { kind: "stage", current: "Ready" };
  return { kind: "stage", current: "Scored" };
}
