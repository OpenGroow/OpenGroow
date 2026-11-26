"use client";

import { useSearchParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { AgentWorkspaceView } from "@/src/components/agent-workspace-view";
import { RunTraceView } from "@/src/components/trace/run-trace-view";

/** The Trace of a Job's or Source's Run, under its Agent: `?runId=` names the Run (as the Agent's logs do). */
export function AgentRunTraceView({ instanceId, templateId }: { instanceId: string; templateId: string }) {
  const runId = useSearchParams().get("runId");
  if (!runId) return <p className="m-0 text-sm text-muted-foreground">No Run selected.</p>;
  return (
    <AgentWorkspaceView instanceId={instanceId} templateId={templateId}>
      {(params) => <RunTraceView params={params} runId={runId as Id<"runs">} />}
    </AgentWorkspaceView>
  );
}
