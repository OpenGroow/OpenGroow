export const SOURCE_PIPELINE_STAGES = [
  "Ingestion",
  "Ready",
  "Scored",
  "Routed",
  "In production",
  "Produced",
  "Published",
] as const;

export type SourcePipelineStage = (typeof SOURCE_PIPELINE_STAGES)[number];
export type SourcePipelineState =
  | { kind: "stage"; current: SourcePipelineStage }
  | { kind: "terminal"; label: "Failed" | "Unavailable" | "Excluded" };

export type SourcePipelineSource = {
  status: "processing" | "ready" | "failed" | "unavailable";
  scoring?: Record<string, number>;
  selectedAt?: number;
  productionMissionId?: string;
  producedAt?: number;
  publishedAt?: number;
  excluded?: boolean;
};

/** Derives the visible lifecycle from the Source facts, never a stored stage. */
export function deriveSourcePipelineState(source: SourcePipelineSource): SourcePipelineState {
  if (source.excluded === true) return { kind: "terminal", label: "Excluded" };
  if (source.status === "failed") return { kind: "terminal", label: "Failed" };
  if (source.status === "unavailable") return { kind: "terminal", label: "Unavailable" };
  if (source.status === "processing") return { kind: "stage", current: "Ingestion" };
  if (source.scoring === undefined) return { kind: "stage", current: "Ready" };
  if (source.selectedAt === undefined) return { kind: "stage", current: "Scored" };
  if (source.productionMissionId === undefined) return { kind: "stage", current: "Routed" };
  if (source.producedAt === undefined) return { kind: "stage", current: "In production" };
  if (source.publishedAt === undefined) return { kind: "stage", current: "Produced" };
  return { kind: "stage", current: "Published" };
}
