"use client";

import Link from "next/link";
import * as React from "react";
import { use } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type {
  InstanceRecord,
  ParsedWorkspaceListPayload,
} from "@/src/components/instance-workspace.types";
import type { RuntimeWorkspaceDescriptor } from "@opengroow/protocol";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import {
  toWorkspaceListPayload,
  useWorkspaceOperation,
} from "@/src/hooks/use-workspace-operations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type InstanceWorkspacesPageProps = {
  params: Promise<{ instanceId: string }>;
};

export function InstanceWorkspacesPage({ params }: InstanceWorkspacesPageProps) {
  const { instanceId } = use(params);
  const decodedInstanceId = decodeURIComponent(instanceId);
  const { manifests } = useProjectManifests(decodedInstanceId);
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const listWorkspaces = useAction(api.workspace_operations_node.listWorkspaces);
  const instance = instances?.find(
    (entry) =>
      entry.openclawId === decodedInstanceId || entry.jobId === decodedInstanceId,
  );
  const runtimeInstanceId = instance?.openclawId?.trim() ?? "";
  const agents = useQuery(
    api.project_agents.listByInstance,
    runtimeInstanceId ? { instanceId: runtimeInstanceId } : "skip",
  );

  // A managed workspace belongs to an Agent: it is browsed from the Agent's
  // Files tab. The other kinds only exist for the Project's inventory.
  const agentOf = React.useCallback(
    (workspace: RuntimeWorkspaceDescriptor) => {
      if (workspace.kind !== "managed") return undefined;
      const record = agents?.find((agent) => agent.workspaceKey === workspace.workspaceKey);
      const manifest = manifests.find((candidate) => candidate.id === record?.templateId);
      return manifest ? { templateId: manifest.id, name: manifest.name } : undefined;
    },
    [agents, manifests],
  );

  // Seed from Convex cache so the page is instantly populated on every visit.
  const cachedWorkspaces: RuntimeWorkspaceDescriptor[] = React.useMemo(
    () => (instance?.workspaceList?.workspaces as RuntimeWorkspaceDescriptor[] | undefined) ?? [],
    [instance?.workspaceList],
  );

  const [resetKey, setResetKey] = React.useState(0);
  const listRequest = runtimeInstanceId
    ? { instanceId: runtimeInstanceId, resetKey }
    : null;
  const listResult = useWorkspaceOperation<{}, ParsedWorkspaceListPayload>({
    request: listRequest,
    run: React.useCallback(
      ({ instanceId: id }) =>
        listWorkspaces({ instanceId: id }).then(toWorkspaceListPayload),
      [listWorkspaces],
    ),
  });

  // Prefer fresh data from the latest runtime poll; fall back to cached.
  const freshWorkspaces = listResult.status === "data" ? listResult.data.workspaces : null;
  const workspaces: RuntimeWorkspaceDescriptor[] = freshWorkspaces ?? cachedWorkspaces;
  const refreshing = listResult.status === "loading" && resetKey > 0;
  const error = listResult.status === "error" ? listResult.error : null;
  const handleRefresh = React.useCallback(() => {
    if (!refreshing) setResetKey((key) => key + 1);
  }, [refreshing]);

  if (!instance) {
    return null;
  }

  if (!runtimeInstanceId) {
    return (
      <section className="grid gap-6">
        <WorkspaceHeader />
        <EmptyPanel
          title="Workspace unavailable"
          description="This Project has no linked OpenClaw runtime yet, so no workspace can be queried."
        />
      </section>
    );
  }

  return (
    <section className="grid gap-8">
      <WorkspaceHeader
        action={
          <Button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="h-11 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {error ? (
        <EmptyPanel title="Could not load workspaces" description={error} tone="error" />
      ) : null}

      {!error && workspaces.length === 0 && !freshWorkspaces ? (
        <EmptyPanel
          title="Loading workspaces"
          description="Querying the runtime for the current OpenClaw workspaces."
        />
      ) : null}

      {!error && workspaces.length === 0 && freshWorkspaces !== null ? (
        <EmptyPanel
          title="No workspaces detected"
          description="The runtime did not report any OpenClaw workspace directories for this Project."
        />
      ) : null}

      {workspaces.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {workspaces.map((workspace) => {
            const agent = agentOf(workspace);
            return (
            <Card
              key={workspace.workspaceKey}
              className="rounded-[1.7rem] border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))] py-4 shadow-[var(--dashboard-shadow)]"
            >
              <CardHeader className="grid gap-3 px-6 pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-[rgba(220,230,224,0.5)] px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                    {workspace.kind}
                  </span>
                  {workspace.isActive && workspace.kind !== "default" ? (
                    <span className="rounded-full bg-[rgba(188,237,215,0.7)] px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-primary)]">
                      Active
                    </span>
                  ) : null}
                </div>
                <CardTitle className="text-[1.35rem] leading-[1.08] tracking-[-0.04em] text-[var(--dashboard-ink)]">
                  {agent?.name ?? workspace.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 px-6 pt-5">
                <div className="grid gap-2 text-sm leading-6 text-[var(--dashboard-ink-muted)]">
                  <p className="m-0">
                    <span className="font-semibold text-[var(--dashboard-ink)]">Path:</span>{" "}
                    <code>{workspace.absolutePath}</code>
                  </p>
                  <p className="m-0">
                    <span className="font-semibold text-[var(--dashboard-ink)]">Files:</span>{" "}
                    {workspace.availableFiles.length}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {workspace.availableFiles.slice(0, 4).map((file) => (
                    <span
                      key={file.filePath}
                      className="rounded-full bg-[rgba(0,38,27,0.05)] px-3 py-1 text-[0.8rem] text-[var(--dashboard-ink-muted)]"
                    >
                      {file.filePath}
                    </span>
                  ))}
                  {workspace.availableFiles.length > 4 ? (
                    <span className="rounded-full bg-[rgba(0,38,27,0.05)] px-3 py-1 text-[0.8rem] text-[var(--dashboard-ink-muted)]">
                      +{workspace.availableFiles.length - 4} more
                    </span>
                  ) : null}
                </div>

                {workspace.kind === "managed" && agents === undefined ? (
                  // The owning Agent is not known yet: linking now would send a
                  // managed workspace to the generic detail page, not Agent Files.
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-[rgba(0,38,27,0.12)] bg-[linear-gradient(135deg,rgba(188,237,215,0.96),rgba(227,242,234,0.98))] px-5 font-semibold text-[var(--dashboard-primary)] shadow-[0_16px_30px_rgba(0,38,27,0.12)] transition hover:-translate-y-0.5 hover:border-[rgba(0,38,27,0.16)] hover:bg-[linear-gradient(135deg,rgba(174,230,205,1),rgba(214,236,226,1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,38,27,0.18)] focus-visible:ring-offset-2 pointer-events-none opacity-50"
                  >
                    Open Files
                  </span>
                ) : (
                  <Link
                    href={
                      agent
                        ? `/projects/${encodeURIComponent(decodedInstanceId)}/agents/${encodeURIComponent(agent.templateId)}/files`
                        : `/projects/${encodeURIComponent(decodedInstanceId)}/settings/workspaces/${encodeURIComponent(workspace.workspaceKey)}`
                    }
                    className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-[rgba(0,38,27,0.12)] bg-[linear-gradient(135deg,rgba(188,237,215,0.96),rgba(227,242,234,0.98))] px-5 font-semibold text-[var(--dashboard-primary)] shadow-[0_16px_30px_rgba(0,38,27,0.12)] transition hover:-translate-y-0.5 hover:border-[rgba(0,38,27,0.16)] hover:bg-[linear-gradient(135deg,rgba(174,230,205,1),rgba(214,236,226,1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,38,27,0.18)] focus-visible:ring-offset-2"
                  >
                    {agent ? "Open Files" : "Open workspace"}
                  </Link>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
      <div className="grid gap-2">
        <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
          Runtime Workspace
        </span>
        <h1 className="m-0 text-[clamp(2.2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
          Workspaces
        </h1>
        <p className="m-0 max-w-3xl text-[1rem] leading-7 text-[var(--dashboard-ink-muted)]">
          Browse the real OpenClaw workspace directories mounted in this Project and inspect their canonical Markdown files.
        </p>
      </div>
      {action}
    </header>
  );
}

function EmptyPanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "error";
}) {
  return (
    <Card
      className={`rounded-[1.7rem] border-0 py-5 shadow-[var(--dashboard-shadow)] ${
        tone === "error"
          ? "bg-[rgba(84,41,37,0.06)]"
          : "bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))]"
      }`}
    >
      <CardContent className="grid gap-2 px-6">
        <h2 className="m-0 text-[1.15rem] leading-[1.08] tracking-[-0.03em] text-[var(--dashboard-ink)]">
          {title}
        </h2>
        <p className="m-0 text-[0.96rem] leading-7 text-[var(--dashboard-ink-muted)]">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
