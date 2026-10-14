"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { notFound } from "next/navigation";
import { useProjectManifest } from "@/src/hooks/use-project-manifests";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { InstanceWorkspaceDetailPage } from "@/src/components/instance-workspace-detail-page";
import { WorkspaceLogsPage } from "@/src/components/workspace-logs-page";
import { WorkspacePromptPage } from "@/src/components/workspace-prompt-page";

// Carries both spellings of the Project id: Logs/Prompt pages read `projectId`,
// the file explorer reads `instanceId`.
type WorkspaceParams = Promise<{ projectId: string; instanceId: string; workspaceKey: string }>;

/**
 * An Agent's Files / Logs / Prompt pages read its managed workspace, which is
 * keyed by `workspaceKey`; the Agent URL only carries the `templateId`. Looks
 * the key up and hands it to the wrapped workspace page.
 */
export function AgentWorkspaceView({
  instanceId,
  templateId,
  children,
}: {
  instanceId: string;
  templateId: string;
  children: (params: WorkspaceParams) => React.ReactNode;
}) {
  // A Template the Project does not offer is a 404, whatever the tab.
  if (useProjectManifest(instanceId, templateId) === null) notFound();
  const runtimeInstanceId = useRuntimeInstanceId(instanceId);
  const agents = useQuery(
    api.project_agents.listByInstance,
    runtimeInstanceId ? { instanceId: runtimeInstanceId } : "skip",
  );
  // Deactivation keeps `workspaceKey`, so an inactive Agent must be excluded
  // here too: a direct URL would otherwise still open its Files, Logs and Prompt.
  const agent = agents?.find((a) => a.templateId === templateId);
  const workspaceKey = agent?.status === "active" ? agent.workspaceKey : undefined;
  // The wrapped pages `use()` their params: the promise must be stable across renders.
  // They decode route params themselves, and `instanceId`/`workspaceKey` are
  // already decoded here, so re-encode to hand them what a route would carry
  // (decoding twice breaks ids containing percent-escape-looking text).
  const params = React.useMemo<WorkspaceParams | null>(() => {
    if (!workspaceKey) return null;
    const encodedInstanceId = encodeURIComponent(instanceId);
    return Promise.resolve({
      projectId: encodedInstanceId,
      instanceId: encodedInstanceId,
      workspaceKey: encodeURIComponent(workspaceKey),
    });
  }, [instanceId, workspaceKey]);

  if (agents === undefined) return null;
  if (!params) {
    return (
      <p className="m-0 text-[0.9rem] text-[var(--dashboard-ink-muted)]">
        Activate this Agent from the Agents list to see its workspace.
      </p>
    );
  }
  // The wrapped pages `use()` the params promise, which suspends once.
  return <React.Suspense fallback={null}>{children(params)}</React.Suspense>;
}

type ViewProps = { instanceId: string; templateId: string };

export function AgentFilesView({ instanceId, templateId }: ViewProps) {
  return (
    <AgentWorkspaceView instanceId={instanceId} templateId={templateId}>
      {(params) => (
        <InstanceWorkspaceDetailPage
          params={params}
          agentTemplateId={templateId}
        />
      )}
    </AgentWorkspaceView>
  );
}

export function AgentLogsView({ instanceId, templateId }: ViewProps) {
  return (
    <AgentWorkspaceView instanceId={instanceId} templateId={templateId}>
      {(params) => <WorkspaceLogsPage params={params} agentTemplateId={templateId} />}
    </AgentWorkspaceView>
  );
}

export function AgentPromptView({ instanceId, templateId }: ViewProps) {
  return (
    <AgentWorkspaceView instanceId={instanceId} templateId={templateId}>
      {(params) => <WorkspacePromptPage params={params} />}
    </AgentWorkspaceView>
  );
}
