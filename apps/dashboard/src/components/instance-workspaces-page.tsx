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
        <div className="grid gap-5 xl:grid-cols-2">
          {workspaces.map((workspace) => {
            const agent = agentOf(workspace);
            return (
            <Card
              key={workspace.workspaceKey}
              className="py-4"
            >
              <CardHeader className="grid gap-3 px-6 pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge>
                    {workspace.kind}
                  </Badge>
                  {workspace.isActive && workspace.kind !== "default" ? (
                    <Badge variant="default">
                      Active
                    </Badge>
                  ) : null}
                </div>
                <CardTitle className="text-lg tracking-tight text-foreground">
                  {agent?.name ?? workspace.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 px-6 pt-5">
                <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
                  <p className="m-0">
                    <span className="font-semibold text-foreground">Path:</span>{" "}
                    <code>{workspace.absolutePath}</code>
                  </p>
                  <p className="m-0">
                    <span className="font-semibold text-foreground">Files:</span>{" "}
                    {workspace.availableFiles.length}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {workspace.availableFiles.slice(0, 4).map((file) => (
                    <Badge
                      key={file.filePath}>
                      {file.filePath}
                    </Badge>
                  ))}
                  {workspace.availableFiles.length > 4 ? (
                    <Badge>
                      +{workspace.availableFiles.length - 4} more
                    </Badge>
                  ) : null}
                </div>

                {workspace.kind === "managed" && agents === undefined ? (
                  // The owning Agent is not known yet: linking now would send a
                  // managed workspace to the generic detail page, not Agent Files.
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border bg-primary/15 px-5 font-semibold text-primary transition hover:-translate-y-0.5 hover:border-input hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 pointer-events-none opacity-50"
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
                    className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border bg-primary/15 px-5 font-semibold text-primary transition hover:-translate-y-0.5 hover:border-input hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
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
