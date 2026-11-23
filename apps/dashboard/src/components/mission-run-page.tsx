"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { use } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TabNav } from "@/components/opengroow/tab-nav";
import { AgentWorkspaceView } from "@/src/components/agent-workspace-view";
import { WorkspacePromptPage } from "@/src/components/workspace-prompt-page";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import { TranscriptPanel } from "@/src/components/workspace-logs-transcript";
import type { TranscriptState } from "@/src/components/workspace-logs.types";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { missionHref, missionRunHref } from "@/src/lib/instance-path";
import { titleCase } from "@/src/lib/mission-type";

type RunViewProps = { instanceId: string; missionId: string; runId: string };

const RUN_NOT_FOUND = <p className="m-0 text-sm text-muted-foreground">This Run was not found.</p>;

/** Convex refuses an id that is not one of its own (a mistyped URL): show "not found" instead of crashing the page. */
class RunNotFoundBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? RUN_NOT_FOUND : this.props.children;
  }
}

/**
 * One Run of a Mission, under the Mission: a header that says which Mission and
 * Run this is, a way back to the Mission, and the Run's Prompt and Logs as tabs.
 * They used to open under the Agent's pages, which dropped the Mission context.
 */
export function MissionRunShell(props: RunViewProps & { children: React.ReactNode }) {
  return (
    <RunNotFoundBoundary>
      <MissionRunHeader {...props} />
    </RunNotFoundBoundary>
  );
}

function MissionRunHeader({ instanceId, missionId, runId, children }: RunViewProps & { children: React.ReactNode }) {
  const pathname = usePathname();
  const mission = useQuery(api.missions.get, { missionId: missionId as Id<"missions"> });
  const run = useQuery(api.runs.get, { runId: runId as Id<"runs"> });
  const tabs = [
    { label: "Prompt", href: missionRunHref(instanceId, missionId, runId, "prompt"), enabled: true },
    { label: "Logs", href: missionRunHref(instanceId, missionId, runId, "logs"), enabled: true },
  ];

  // A Run belongs to one Mission: a URL pairing a Mission with another Mission's Run shows neither.
  if (mission === null || run === null || (run && run.missionId !== missionId)) return RUN_NOT_FOUND;
  return (
    <section className="grid min-w-0 gap-6">
      <header className="grid gap-4">
        <Link href={missionHref(instanceId, missionId)} className="text-xs font-semibold text-muted-foreground hover:text-primary">
          ← {mission ? titleCase(mission.type) : "Mission"}
        </Link>
        <h1 className="m-0 text-3xl font-bold tracking-tight break-words text-foreground sm:text-4xl">
          Run{mission ? ` of ${titleCase(mission.type)}` : ""}
        </h1>
        <TabNav items={tabs} current={pathname} label="Run sections" />
      </header>
      {children}
    </section>
  );
}

/** The Agent's workspace for this Run, found from the Run itself. */
function RunWorkspace({
  instanceId,
  runId,
  children,
}: {
  instanceId: string;
  runId: string;
  children: React.ComponentProps<typeof AgentWorkspaceView>["children"];
}) {
  const run = useQuery(api.runs.get, { runId: runId as Id<"runs"> });
  if (!run) return null;
  return (
    <AgentWorkspaceView instanceId={instanceId} templateId={run.templateId}>
      {children}
    </AgentWorkspaceView>
  );
}

export function MissionRunPromptView({ instanceId, missionId, runId }: RunViewProps) {
  return (
    <RunWorkspace instanceId={instanceId} runId={runId}>
      {(params) => (
        <WorkspacePromptPage params={params} runId={runId as Id<"runs">} missionId={missionId as Id<"missions">} />
      )}
    </RunWorkspace>
  );
}

export function MissionRunLogsView({ instanceId, runId }: Pick<RunViewProps, "instanceId" | "runId">) {
  return (
    <RunWorkspace instanceId={instanceId} runId={runId}>
      {(params) => <RunTranscript params={params} runId={runId as Id<"runs">} />}
    </RunWorkspace>
  );
}

/** The session transcript of this one Run: what the Agent said and did. */
function RunTranscript({
  params,
  runId,
}: {
  params: Promise<{ projectId: string; workspaceKey: string }>;
  runId: Id<"runs">;
}) {
  const { projectId, workspaceKey } = use(params);
  const runtimeInstanceId = useRuntimeInstanceId(decodeURIComponent(projectId));
  const decodedWorkspaceKey = decodeURIComponent(workspaceKey);
  const getWorkspaceRunTranscript = useAction(api.workspace_logs_node.getWorkspaceRunTranscript);
  const [transcript, setTranscript] = React.useState<TranscriptState>({ status: "loading" });
  const latestRequestId = React.useRef(0);

  React.useEffect(() => {
    if (!runtimeInstanceId) return;
    const requestId = ++latestRequestId.current;
    setTranscript({ status: "loading" });
    getWorkspaceRunTranscript({ instanceId: runtimeInstanceId, workspaceKey: decodedWorkspaceKey, runId })
      .then((result) => {
        if (requestId !== latestRequestId.current) return;
        setTranscript({ status: "data", found: result.found, turns: result.turns, runId: result.runId ?? null });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setTranscript({ status: "error", error: err instanceof Error ? err.message : "Failed to load logs" });
      });
    // getWorkspaceRunTranscript is intentionally omitted: useAction returns a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeInstanceId, decodedWorkspaceKey, runId]);

  if (!runtimeInstanceId) {
    return <LogsStatePanel title="Logs unavailable" description="This project isn't connected yet, so no logs can be shown." />;
  }
  return <TranscriptPanel transcript={transcript} />;
}
