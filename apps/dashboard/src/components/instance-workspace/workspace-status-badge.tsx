import type { WorkspaceStatusTone } from "@/src/components/instance-workspace.types";

export function WorkspaceStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: WorkspaceStatusTone;
}) {
  return (
    <span
      className={`inline-flex min-h-8 items-center justify-center rounded-full px-3.5 py-1 text-[0.8125rem] font-bold uppercase tracking-[0.12em] ${
        tone === "success"
          ? "bg-[rgba(206,241,221,0.92)] text-[var(--dashboard-primary)]"
          : "bg-[rgba(227,230,231,0.95)] text-[var(--dashboard-ink-muted)]"
      }`}
    >
      {label}
    </span>
  );
}
