import * as React from "react";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { runStatus } from "@/components/opengroow/mission-status";
import { formatDurationMs } from "@/src/lib/trace/format-trace";

/** Run status, Run duration (elapsed, not an Observed duration), Tool Call count, failed count. */
export function TraceSummary({
  runStatus: status,
  runDurationMs,
  toolCallCount,
  failedToolCallCount,
  footer,
}: {
  runStatus: string;
  runDurationMs?: number;
  toolCallCount: number;
  failedToolCallCount: number;
  /** Extension point (#203): e.g. the "waiting for the External Job" footer. */
  footer?: React.ReactNode;
}) {
  const { tone, label } = runStatus(status);
  return (
    <section className="grid gap-2 rounded-2xl border border-border bg-card p-5" aria-label="Trace summary" data-testid="trace-summary">
      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
        <Stat label="Run status">
          <StatusBadge tone={tone} label={label} size="default" />
        </Stat>
        <Stat label="Run duration">{formatDurationMs(runDurationMs) ?? "—"}</Stat>
        <Stat label="Tool Calls">{toolCallCount}</Stat>
        <Stat label="Failed Tool Calls">{failedToolCallCount}</Stat>
      </dl>
      {footer}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="m-0 text-lg font-semibold text-foreground">{children}</dd>
    </div>
  );
}
