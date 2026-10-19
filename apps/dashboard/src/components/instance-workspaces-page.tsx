"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/opengroow/page-header";

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
          <Button variant="secondary" size="lg"
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
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
        <Card className="w-full max-w-3xl overflow-hidden py-0">
          <ul className="m-0 grid list-none p-0">
            {workspaces.map((workspace) => {
              const agent = agentOf(workspace);
              // The owning Agent is not known yet while its Agents load: linking now
              // would send a managed workspace to the generic detail page.
              const pending = workspace.kind === "managed" && agents === undefined;
              const href = agent
                ? `/projects/${encodeURIComponent(decodedInstanceId)}/agents/${encodeURIComponent(agent.templateId)}/files`
                : `/projects/${encodeURIComponent(decodedInstanceId)}/settings/workspaces/${encodeURIComponent(workspace.workspaceKey)}`;
              const title = agent?.name ?? workspace.label;
              const count = workspace.availableFiles.length;
              const row = (
                <>
                  <span className="flex min-w-0 items-center gap-3 font-medium text-foreground">
                    <span className="truncate">{title}</span>
                    {workspace.isActive && workspace.kind !== "default" ? (
                      <Badge variant="default">Active</Badge>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                    {count} {count === 1 ? "file" : "files"}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                </>
              );
              const rowClass =
                "flex items-center justify-between gap-4 px-6 py-6";
              return (
                <li key={workspace.workspaceKey} className="border-b border-foreground/15 last:border-b-0">
                  {pending ? (
                    <span aria-disabled="true" className={`${rowClass} opacity-50`}>
                      {row}
                    </span>
                  ) : (
                    <Link
                      href={href}
                      className={`${rowClass} transition hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50`}
                    >
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

function WorkspaceHeader({ action }: { action?: React.ReactNode }) {
  return (
    <PageHeader title="Workspaces" description="Browse the OpenClaw workspaces mounted in this Project." action={action} />
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
      className={`rounded-xl border-0 py-5  ${
        tone === "error"
          ? "bg-destructive/10"
          : "bg-card"
      }`}
    >
      <CardContent className="grid gap-2 px-6">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="m-0 text-base leading-7 text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
