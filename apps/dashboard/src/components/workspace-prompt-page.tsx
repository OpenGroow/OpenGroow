"use client";

import { useSearchParams } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";

// Mirrors `transcriptTurnZ` in apps/convex/workspace_logs_node.ts — only the
// shape this page reads (the full turn union also has `message`/`tool_result`,
// irrelevant here).
type ToolCallTurn = { kind: "tool_call"; toolName: string; arguments?: unknown };

type TranscriptState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "data"; toolCalls: ToolCallTurn[] };

type WorkspacePromptPageProps = {
  params: Promise<{ projectId: string; workspaceKey: string }>;
};

export function WorkspacePromptPage({ params }: WorkspacePromptPageProps) {
  const { projectId, workspaceKey } = use(params);
  const { manifests } = useProjectManifests(decodeURIComponent(projectId));
  const decodedWorkspaceKey = decodeURIComponent(workspaceKey);
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") as Id<"runs"> | null;
  // Read straight from the link (mission-detail-page.tsx's RunRow) so both
  // Convex queries fire in parallel on mount, instead of waiting for `run`
  // to resolve before mission.get can even start.
  const missionId = searchParams.get("missionId") as Id<"missions"> | null;

  const run = useQuery(api.runs.get, runId ? { runId } : "skip");
  const mission = useQuery(api.missions.get, missionId ? { missionId } : "skip");
  // Every Run has its own OpenClaw session (`mega-run-${runId}`, apps/convex/missions.ts) —
  // sessions are never shared across a Mission's Runs. The generative tool_call
  // may have happened on an earlier Run than the one being viewed (e.g. an
  // ADR-026 Intermediate External Job resolved on Run A, and Run B continued
  // on to a Terminal job) — `missionRuns` lets us find that specific Run.
  const missionRuns = useQuery(api.runs.listByMission, missionId ? { missionId } : "skip");

  const template = manifests.find((t) => t.id === run?.templateId);
  const generativeToolName = mission ? template?.generativeMcpCall?.[mission.type]?.toolName : undefined;
  const sourceRun = generativeToolName
    ? missionRuns?.find(
        (r) =>
          r.intermediateResult &&
          typeof r.intermediateResult === "object" &&
          (r.intermediateResult as { jobType?: unknown }).jobType === generativeToolName,
      )
    : undefined;
  const transcriptRunId = sourceRun?._id ?? runId;
  const missionRunsResolved = missionRuns !== undefined;
  // The manifest's declared job contract (ADR-050's cross-check with
  // validateManifest already guarantees this, when present, names the same
  // tool as generativeMcpCall) carries the MCP server name, letting the
  // transcript match be exact instead of a same-name-on-any-server guess.
  const generativeServer =
    generativeToolName && mission
      ? template?.externalJobsByMissionType?.[mission.type]?.[generativeToolName]?.server
      : undefined;

  // ADR-050: the exact payload sent to the generative MCP tool only exists
  // in a Run's OpenClaw session transcript (the same generic, per-Template
  // capture already behind "View logs") — never in a job's output, which is
  // a result, not the request.
  const runtimeInstanceId = useRuntimeInstanceId(decodeURIComponent(projectId));
  const getWorkspaceRunTranscript = useAction(api.workspace_logs_node.getWorkspaceRunTranscript);
  const [transcript, setTranscript] = useState<TranscriptState>({ status: "loading" });
  const latestRequestId = useRef(0);

  useEffect(() => {
    // Wait for missionRuns to settle before fetching: `transcriptRunId`
    // isn't final until then (it may still flip from `runId` to a different
    // `sourceRun`), and firing on the interim value would waste a live
    // runtime round trip on a request we're about to discard.
    if (!runtimeInstanceId || !transcriptRunId || !missionRunsResolved) return;
    const requestId = ++latestRequestId.current;
    setTranscript({ status: "loading" });
    void getWorkspaceRunTranscript({ instanceId: runtimeInstanceId, workspaceKey: decodedWorkspaceKey, runId: transcriptRunId })
      .then((result) => {
        if (requestId !== latestRequestId.current) return;
        setTranscript({
          status: "data",
          toolCalls: result.turns.filter((turn): turn is ToolCallTurn => turn.kind === "tool_call"),
        });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setTranscript({ status: "error", error: err instanceof Error ? err.message : "Failed to load the transcript" });
      });
    // getWorkspaceRunTranscript is intentionally omitted: useAction returns a
    // stable ref across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeInstanceId, decodedWorkspaceKey, transcriptRunId, missionRunsResolved]);

  if (run === undefined) {
    return null;
  }
  if (run === null) {
    return <p className="text-[0.88rem] text-[var(--dashboard-ink-muted)]">Run not found.</p>;
  }

  // The transcript records an MCP tool_call's name prefixed by its server
  // (e.g. "media-mcp.generate_assets"), while `generativeMcpCall`
  // declares the bare tool name to stay consistent with
  // `externalJobsByMissionType`'s job-type keys. Match the exact
  // `server.toolName` when the server is known; otherwise fall back to a
  // same-name match regardless of server.
  const generationCall =
    transcript.status === "data" && generativeToolName
      ? transcript.toolCalls.find((turn) =>
          generativeServer
            ? turn.toolName === `${generativeServer}.${generativeToolName}`
            : turn.toolName === generativeToolName || turn.toolName.endsWith(`.${generativeToolName}`),
        )
      : undefined;

  return (
    <section className="grid gap-8">
      <h1 className="m-0 text-[1.4rem] font-semibold">Prompt</h1>

      <div className="grid gap-3">
        <h2 className="m-0 text-[0.9rem] font-bold uppercase tracking-[0.14em]">Instructions</h2>
        <p className="m-0 max-w-2xl text-[0.9rem] leading-6 text-[var(--dashboard-ink-muted)]">
          This is what OpenGroow&apos;s own agent received when this Run started: the Template&apos;s rules for this
          Mission type, plus the Brand Core and Mission context. The agent reads this and decides what to write —
          it is not the final content itself.
        </p>
        {run.agentsMdSnapshot && <WorkspaceMarkdown content={run.agentsMdSnapshot} />}
        {run.contextMdSnapshot && <WorkspaceMarkdown content={run.contextMdSnapshot} />}
      </div>

      {generativeToolName && (
        <div className="grid gap-3">
          <h2 className="m-0 text-[0.9rem] font-bold uppercase tracking-[0.14em]">Génération</h2>
          <p className="m-0 max-w-2xl text-[0.9rem] leading-6 text-[var(--dashboard-ink-muted)]">
            This is what actually reached <code className="text-[0.88em]">{generativeToolName}</code>, the MCP tool
            that produced this Mission&apos;s deliverable — written by the agent based on the Instructions above. To
            change this output, edit the Brand Core or the Template&apos;s instructions; this panel is read-only.
          </p>
          {transcript.status === "loading" && (
            <p className="m-0 text-[0.85rem] text-[var(--dashboard-ink-muted)]">Loading the session transcript…</p>
          )}
          {transcript.status === "error" && (
            <p className="m-0 text-[0.85rem] text-red-700">{transcript.error}</p>
          )}
          {transcript.status === "data" && generationCall && (
            <WorkspaceMarkdown content={"```json\n" + JSON.stringify(generationCall.arguments, null, 2) + "\n```"} />
          )}
          {transcript.status === "data" && !generationCall && (
            <p className="m-0 text-[0.85rem] text-[var(--dashboard-ink-muted)]">
              No <code className="text-[0.88em]">{generativeToolName}</code> call found in this Run&apos;s session
              transcript.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
