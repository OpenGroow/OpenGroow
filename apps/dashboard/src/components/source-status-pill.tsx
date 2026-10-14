import type { Doc } from "@convex/_generated/dataModel";
import { StatusPill } from "@/components/ui/status-pill";
import {
  deriveSourcePipelineState,
  type SourcePipelineSource,
  type SourcePipelineStage,
} from "@/src/lib/source-pipeline";

// Derived from the table rather than restated, so a new status cannot be added
// in Convex without this map failing to compile.
export type SourceStatus = Doc<"sources">["status"];

// Muted grey while in
// flight, green when ready, brown for a (retryable) failure, and a distinct
// greyed pill for `unavailable` (structurally unanalyzable, never retryable).
const SOURCE_STATUS_BADGE: Record<SourceStatus, { label: string; className: string }> = {
  processing: { label: "Processing", className: "bg-[rgba(220,230,224,0.7)] text-[var(--dashboard-ink-soft)]" },
  ready: { label: "Ready", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  failed: { label: "Failed", className: "bg-[rgba(84,41,37,0.08)] text-[var(--dashboard-tertiary)]" },
  unavailable: { label: "Unavailable", className: "bg-[rgba(0,38,27,0.06)] text-[var(--dashboard-ink-muted)]" },
};

export function SourceStatusPill({ status }: { status: SourceStatus }) {
  const { label, className } = SOURCE_STATUS_BADGE[status];
  return <StatusPill label={label} className={className} />;
}

const PIPELINE_STAGE_BADGE: Record<SourcePipelineStage, { label: string; className: string }> = {
  Ingestion: { label: "Ingestion", className: "bg-[rgba(220,230,224,0.7)] text-[var(--dashboard-ink-soft)]" },
  Ready: { label: "Ready", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  Scored: { label: "Scored", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  Routed: { label: "Routed", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  "In production": { label: "In production", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  Produced: { label: "Produced", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
  Published: { label: "Published", className: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]" },
};

const TERMINAL_BADGE: Record<"Failed" | "Unavailable" | "Excluded", { label: string; className: string }> = {
  Failed: SOURCE_STATUS_BADGE.failed,
  Unavailable: SOURCE_STATUS_BADGE.unavailable,
  Excluded: { label: "Excluded", className: "bg-[rgba(0,38,27,0.06)] text-[var(--dashboard-ink-muted)]" },
};

export function SourcePipelinePill({ source }: { source: SourcePipelineSource }) {
  const state = deriveSourcePipelineState(source);
  const badge = state.kind === "stage" ? PIPELINE_STAGE_BADGE[state.current] : TERMINAL_BADGE[state.label];
  return <StatusPill label={badge.label} className={badge.className} />;
}

export function formatSourceDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
