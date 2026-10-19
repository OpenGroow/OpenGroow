/**
 * The small labelled chips the Engagement Report is built from: the agent's
 * decision, its relevance score, and the stat cards in the header row.
 */
"use client";

import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/opengroow/status-badge";

const DECISION_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  liked: { label: "Liked", tone: "info" },
  commented: { label: "Commented", tone: "info" },
  liked_and_commented: { label: "Liked & Commented", tone: "active" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "error" },
};

export function DecisionBadge({ decision }: { decision: string | undefined }) {
  if (!decision) return null;
  const style = DECISION_LABELS[decision] ?? { label: decision, tone: "neutral" as const };
  return <StatusBadge tone={style.tone} label={style.label} />;
}

export function ScoreBadge({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  const pct = Math.min(Math.max(score, 0), 10) / 10;
  const hue = Math.round(pct * 120); // 0 = red, 120 = green
  return (
    <Badge
      style={{
        backgroundColor: `hsl(${hue} 60% 55% / 0.15)`,
        color: `hsl(${hue} 70% 65%)`,
      }}
    >
      {score}/10
    </Badge>
  );
}

export function SummaryCard({ label, count, variant }: { label: string; count: number; variant?: "success" | "neutral" | "danger" | "warning" }) {
  const colors = {
    success: "bg-status-success/10 text-status-success border-status-success/30",
    neutral: "bg-muted text-foreground border-border",
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
  };
  const cls = colors[variant ?? "neutral"];
  return (
    <div className={`flex flex-col items-center rounded-xl border px-4 py-3 ${cls}`}>
      <span className="text-xl font-semibold leading-none">{count}</span>
      <span className="mt-1 text-xs font-semibold">{label}</span>
    </div>
  );
}
