import type { Doc } from "@convex/_generated/dataModel";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";
import {
  deriveSourcePipelineState,
  type SourcePipelineSource,
  type SourcePipelineStage,
} from "@/src/lib/source-pipeline";

// Derived from the table rather than restated, so a new status cannot be added
// in Convex without this map failing to compile.
export type SourceStatus = Doc<"sources">["status"];

// In flight is `progress`, ready/produced work is `active`, a (retryable)
// failure is `error`, and `unavailable` (structurally unanalyzable, never
// retryable) is `neutral` so it reads as inert rather than as an error.
type SourceBadge = { label: string; tone: StatusTone };

const SOURCE_STATUS_BADGE: Record<SourceStatus, SourceBadge> = {
  processing: { label: "Processing", tone: "progress" },
  ready: { label: "Ready", tone: "active" },
  failed: { label: "Failed", tone: "error" },
  unavailable: { label: "Unavailable", tone: "neutral" },
};

export function SourceStatusPill({ status }: { status: SourceStatus }) {
  const { label, tone } = SOURCE_STATUS_BADGE[status];
  return <StatusBadge tone={tone} label={label} />;
}

const PIPELINE_STAGE_BADGE: Record<SourcePipelineStage, SourceBadge> = {
  Ingestion: { label: "Ingestion", tone: "progress" },
  Ready: { label: "Ready", tone: "info" },
  Scored: { label: "Scored", tone: "info" },
  Routed: { label: "Routed", tone: "info" },
  "In production": { label: "In production", tone: "info" },
  Produced: { label: "Produced", tone: "active" },
  Published: { label: "Published", tone: "active" },
};

const TERMINAL_BADGE: Record<"Failed" | "Unavailable" | "Excluded", SourceBadge> = {
  Failed: SOURCE_STATUS_BADGE.failed,
  Unavailable: SOURCE_STATUS_BADGE.unavailable,
  Excluded: { label: "Excluded", tone: "neutral" },
};

export function SourcePipelinePill({ source }: { source: SourcePipelineSource }) {
  const state = deriveSourcePipelineState(source);
  const badge = state.kind === "stage" ? PIPELINE_STAGE_BADGE[state.current] : TERMINAL_BADGE[state.label];
  return <StatusBadge tone={badge.tone} label={badge.label} />;
}

export function formatSourceDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
