"use client";

import * as React from "react";
import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { runDurationMs } from "@/src/lib/trace/format-trace";
import { isTerminalRunStatus, normalizeTrace, summarizeTrace } from "@/src/lib/trace/normalize-trace";
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
  const instanceId = useRuntimeInstanceId(decodeURIComponent(projectId));
  const run = useQuery(api.runs.get, { runId });
  const hasSession = run ? !NO_SESSION_STATUSES.includes(run.status) : false;
  const transcript = useRunTranscript({
    instanceId,
    workspaceKey: decodeURIComponent(workspaceKey),
    runId,
    enabled: hasSession,
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
  const events = normalizeTrace(turns, { id: run._id, status: run.status });
  return (
    <div className="grid min-w-0 gap-4">
      <TraceSummary
        runStatus={run.status}
        runDurationMs={isTerminalRunStatus(run.status) ? runDurationMs(run) : undefined}
        {...summarizeTrace(events)}
      />
      {events.length === 0 ? (
        <LogsStatePanel title="No activity recorded" description="This Run did not produce any recorded events." />
      ) : (
        <TraceTimeline events={events} />
      )}
    </div>
  );
}
