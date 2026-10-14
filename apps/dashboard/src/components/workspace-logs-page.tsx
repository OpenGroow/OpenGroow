"use client";

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { use } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { Button } from "@/components/ui/button";
import { JobList, MissionList } from "@/src/components/workspace-logs-lists";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import { TranscriptPanel } from "@/src/components/workspace-logs-transcript";
import type { TranscriptState } from "@/src/components/workspace-logs.types";

type WorkspaceLogsPageProps = {
  params: Promise<{ projectId: string; workspaceKey: string }>;
  /** Set when rendered as an Agent page's Logs tab, whose tabs replace the back button. */
  agentTemplateId?: string;
};

export function WorkspaceLogsPage({ params, agentTemplateId }: WorkspaceLogsPageProps) {
  const { projectId, workspaceKey } = use(params);
  const decodedProjectId = decodeURIComponent(projectId);
  const decodedWorkspaceKey = decodeURIComponent(workspaceKey);
  const router = useRouter();
  // Deep-link from a Mission's "View logs" (mission-detail-page.tsx RunRow):
  // opens straight to that Run's transcript instead of the workspace's
  // latest Run. Read once on mount — the requested Run never changes while
  // the page stays open, `loadTranscript` calls after that are all
  // user-driven (clicking a different Run in the list).
  const searchParams = useSearchParams();
  const initialRunIdRef = React.useRef(searchParams.get("runId") as Id<"runs"> | null);

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = instances?.find(
    (entry) => entry.openclawId === decodedProjectId || entry.jobId === decodedProjectId,
  );
  const runtimeInstanceId = instance?.openclawId?.trim() ?? "";

  const missions = useQuery(
    api.workspace_logs.listMissionsForWorkspace,
    runtimeInstanceId ? { instanceId: runtimeInstanceId, workspaceKey: decodedWorkspaceKey } : "skip",
  );

  const jobs = useQuery(
    api.workspace_logs.listJobsForWorkspace,
    runtimeInstanceId ? { instanceId: runtimeInstanceId, workspaceKey: decodedWorkspaceKey } : "skip",
  );

  const getWorkspaceRunTranscript = useAction(api.workspace_logs_node.getWorkspaceRunTranscript);

  const [transcript, setTranscript] = React.useState<TranscriptState>({ status: "loading" });
  const [expandedMissionId, setExpandedMissionId] = React.useState<Id<"missions"> | null>(null);
  const [expandedJobId, setExpandedJobId] = React.useState<Id<"jobs"> | null>(null);
  // Derived, not stored: the selected Run is always whichever Run the last
  // successful transcript fetch resolved to.
  const selectedRunId = transcript.status === "data" ? transcript.runId : null;
  // Guards against out-of-order responses: only the most recently started
  // fetch is allowed to apply its result, so clicking through Runs quickly
  // can't have an older fetch overwrite a newer one on completion.
  const latestRequestId = React.useRef(0);

  const loadTranscript = React.useCallback(
    async (runId?: Id<"runs">) => {
      if (!runtimeInstanceId) return;
      const requestId = ++latestRequestId.current;
      setTranscript({ status: "loading" });
      try {
        const result = await getWorkspaceRunTranscript({
          instanceId: runtimeInstanceId,
          workspaceKey: decodedWorkspaceKey,
          ...(runId ? { runId } : {}),
        });
        if (requestId !== latestRequestId.current) return;
        setTranscript({
          status: "data",
          found: result.found,
          turns: result.turns,
          runId: result.runId ?? null,
        });
        if (result.parent?.kind === "mission") {
          setExpandedMissionId(result.parent.missionId);
        } else if (result.parent?.kind === "job") {
          setExpandedJobId(result.parent.jobId);
        }
      } catch (err) {
        if (requestId !== latestRequestId.current) return;
        setTranscript({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load logs",
        });
      }
    },
    // getWorkspaceRunTranscript is intentionally omitted: useAction returns a
    // stable ref across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtimeInstanceId, decodedWorkspaceKey],
  );

  React.useEffect(() => {
    void loadTranscript(initialRunIdRef.current ?? undefined);
  }, [loadTranscript]);

  if (!instances) {
    return null;
  }

  return (
    <section className="grid gap-8">
      <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
        <div className="grid gap-2">
          <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
            Agent Logs
          </span>
          <h1 className="m-0 text-[clamp(2.2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
            Mission, job and Run history
          </h1>
          <p className="m-0 max-w-3xl text-[1rem] leading-7 text-[var(--dashboard-ink-muted)]">
            Browse this Agent&apos;s Missions and jobs, pick a Run, and see what it said and did.
          </p>
        </div>
        {agentTemplateId ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => {
              router.push(
                `/projects/${encodeURIComponent(decodedProjectId)}/settings/workspaces/${encodeURIComponent(decodedWorkspaceKey)}`,
              );
            }}
          >
            Back to Workspace
          </Button>
        )}
      </header>

      {!runtimeInstanceId ? (
        <LogsStatePanel
          title="Logs unavailable"
          description="This project isn't connected yet, so no logs can be shown."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="grid gap-6 self-start">
            <MissionList
              missions={missions}
              expandedMissionId={expandedMissionId}
              selectedRunId={selectedRunId}
              onToggleMission={(missionId) =>
                setExpandedMissionId((current) => (current === missionId ? null : missionId))
              }
              onSelectRun={(runId) => void loadTranscript(runId)}
            />
            <JobList
              jobs={jobs}
              expandedJobId={expandedJobId}
              selectedRunId={selectedRunId}
              onToggleJob={(jobId) => setExpandedJobId((current) => (current === jobId ? null : jobId))}
              onSelectRun={(runId) => void loadTranscript(runId)}
            />
          </div>
          <TranscriptPanel transcript={transcript} />
        </div>
      )}
    </section>
  );
}
