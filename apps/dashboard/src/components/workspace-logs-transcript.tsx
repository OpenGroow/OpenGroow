import * as React from "react";
import { TraceList } from "@/src/components/trace/trace-list";
import { normalizeTrace } from "@/src/lib/trace/normalize-trace";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import type { SessionTranscriptTurn, TranscriptState } from "@/src/components/workspace-logs.types";

/** The selected Run's session transcript — what the Agent said and did. */
export function TranscriptPanel({ transcript }: { transcript: TranscriptState }) {
  if (transcript.status === "loading") {
    return <LogsStatePanel title="Loading logs" description="Reading the selected Run's transcript." />;
  }
  if (transcript.status === "error") {
    return <LogsStatePanel title="Could not load logs" description={transcript.error} tone="error" />;
  }
  if (!transcript.found) {
    return (
      <LogsStatePanel
        title="No runs yet"
        description="This Agent hasn't run yet — logs will appear here after its first run."
      />
    );
  }
  return <TranscriptView turns={transcript.turns} runId={transcript.runId} />;
}

/** The Run's activity as a list of Trace Events. */
function TranscriptView({ turns, runId }: { turns: SessionTranscriptTurn[]; runId: string | null }) {
  // The Run is read after the fact here, so an unanswered call is "unknown", never "running".
  const events = React.useMemo(
    () => normalizeTrace(turns, { id: runId ?? "run", status: "completed" }),
    [turns, runId],
  );
  if (events.length === 0) {
    return <LogsStatePanel title="No activity recorded" description="This run did not produce any recorded turns." />;
  }
  return (
    <div className="grid gap-3 self-start">
      <TraceList events={events} />
    </div>
  );
}
