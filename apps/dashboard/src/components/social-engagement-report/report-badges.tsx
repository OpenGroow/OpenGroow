/**
 * The small labelled chips the Engagement Report is built from: the agent's
 * decision, its relevance score, and the stat cards in the header row.
 */
"use client";

const DECISION_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  liked: { label: "Liked", bg: "bg-blue-50", text: "text-blue-800" },
  commented: { label: "Commented", bg: "bg-purple-50", text: "text-purple-800" },
  liked_and_commented: { label: "Liked & Commented", bg: "bg-green-50", text: "text-green-800" },
  skipped: { label: "Skipped", bg: "bg-gray-100", text: "text-gray-700" },
  failed: { label: "Failed", bg: "bg-red-50", text: "text-red-700" },
};

export function DecisionBadge({ decision }: { decision: string | undefined }) {
  if (!decision) return null;
  const style = DECISION_LABELS[decision] ?? {
    label: decision,
    bg: "bg-gray-100",
    text: "text-gray-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.78rem] font-semibold ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  const pct = Math.min(Math.max(score, 0), 10) / 10;
  const hue = Math.round(pct * 120); // 0 = red, 120 = green
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.78rem] font-semibold"
      style={{
        backgroundColor: `hsl(${hue} 60% 92%)`,
        color: `hsl(${hue} 60% 30%)`,
      }}
    >
      {score}/10
    </span>
  );
}

export function SummaryCard({ label, count, variant }: { label: string; count: number; variant?: "success" | "neutral" | "danger" | "warning" }) {
  const colors = {
    success: "bg-green-50 text-green-800 border-green-200",
    neutral: "bg-gray-50 text-gray-700 border-gray-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const cls = colors[variant ?? "neutral"];
  return (
    <div className={`flex flex-col items-center rounded-2xl border px-4 py-3 ${cls}`}>
      <span className="text-[1.5rem] font-extrabold leading-none">{count}</span>
      <span className="mt-1 text-[0.75rem] font-semibold uppercase tracking-[0.1em]">{label}</span>
    </div>
  );
}
