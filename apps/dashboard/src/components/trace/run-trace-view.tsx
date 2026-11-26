"use client";

import * as React from "react";
import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { runDurationMs } from "@/src/lib/trace/format-trace";
import { isTerminalRunStatus, normalizeTrace, summarizeTrace, type TraceMessageEvent, type TraceToolEvent } from "@/src/lib/trace/normalize-trace";
import { MessageInspector, ToolInspector } from "./tool-inspector";
import { TraceSummary } from "./trace-summary";
import { TraceTimeline } from "./trace-timeline";
import { useRunTranscript } from "./use-run-transcript";

/** Runs that have no session to read yet. */
const NO_SESSION_STATUSES = ["pending", "dispatching"];

/**
 * The Trace of one Run: summary + timeline, derived on demand from the Run's
 * transcript. Read-only. `params` is the Agent workspace's (as for the logs).
 *
 * Extension points: #202 adds the inspector next to the timeline (selection
 * state lives here); #203 passes `mcpJob`-aware handoff badges and the
 * `awaiting_job` footer; #204 changes `useRunTranscript`.
 */
export function RunTraceView({
  params,
  runId,
}: {
  params: Promise<{ projectId: string; workspaceKey: string }>;
  runId: Id<"runs">;
}) {
  const { projectId, workspaceKey } = use(params);
  const [selectedEventId, setSelectedEventId] = React.useState<string>();
  const instanceId = useRuntimeInstanceId(decodeURIComponent(projectId));
  const run = useQuery(api.runs.get, { runId });
  const hasSession = run ? !NO_SESSION_STATUSES.includes(run.status) : false;
  const transcript = useRunTranscript({
    instanceId,
    workspaceKey: decodeURIComponent(workspaceKey),
    runId,
    enabled: hasSession,
    runStatus: run?.status,
  });

  if (run === undefined) return <LogsStatePanel title="Loading trace" description="Reading the Run." />;
  if (run === null) return <LogsStatePanel title="Run not found" description="This Run was not found." />;
  if (!hasSession) {
    return (
      <LogsStatePanel
        title="No trace yet"
        description="This Run has not started, so there is nothing to show yet."
      />
    );
  }
  if (!instanceId) {
    return <LogsStatePanel title="Trace unavailable" description="This project isn't connected yet, so no trace can be shown." />;
  }
  if (transcript.status === "loading") {
    return <LogsStatePanel title="Loading trace" description="Reading the Run's transcript." />;
  }
  if (transcript.status === "error") {
    return <LogsStatePanel title="Could not load the trace" description={transcript.error} tone="error" />;
  }

  const turns = transcript.found ? transcript.turns : [];
  const events = normalizeTrace(turns, { id: run._id, status: run.status, mcpJob: run.mcpJob });
  const selectedTool = events.find((e): e is TraceToolEvent => e.type === "tool" && e.id === selectedEventId);
  const selectedMessage = events.find(
    (e): e is TraceMessageEvent => e.type !== "tool" && e.id === selectedEventId,
  );
  const selected = selectedTool ?? selectedMessage;
  return (
    <div className="grid min-w-0 gap-4">
      {transcript.pollError ? (
        <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Updating is interrupted. Showing the last loaded trace; retrying.
        </p>
      ) : null}
      <TraceSummary
        runStatus={run.status}
        runDurationMs={runDurationMs(run, isTerminalRunStatus(run.status))}
        {...summarizeTrace(events)}
        footer={
          run.status === "awaiting_job" ? (
            <p className="m-0 text-sm text-muted-foreground" data-testid="trace-awaiting-job">
              Waiting for its External Job to finish.
            </p>
          ) : undefined
        }
      />
      {events.length === 0 ? (
        <LogsStatePanel title="No activity recorded" description="This Run did not produce any recorded events." />
      ) : (
        <div className={selected ? "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]" : "grid min-w-0"}>
          <TraceTimeline
            events={events}
            selectedEventId={selectedEventId}
            onSelectTool={(e) => setSelectedEventId(e.id)}
            onSelectMessage={(e) => setSelectedEventId(e.id)}
            renderToolBadge={(event) =>
              event.externalJobHandoff ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary" data-testid="external-job-badge">
                  External Job started
                </span>
              ) : null
            }
          />
          {selectedTool ? <ToolInspector key={selectedTool.id} event={selectedTool} /> : null}
          {selectedMessage ? <MessageInspector key={selectedMessage.id} event={selectedMessage} /> : null}
        </div>
      )}
    </div>
  );
}
