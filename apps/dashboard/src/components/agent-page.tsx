"use client";

import { notFound, usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Pencil, Power, Trash2, TriangleAlert } from "lucide-react";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { mergeTemplatesWithAgents, type AgentCardState } from "@/src/utils/merge-agent-states";
import { flatConfig, hasEditableRequirements, immutableKeys } from "@/src/utils/agent-requirements";
import { useProjectManifest } from "@/src/hooks/use-project-manifests";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { ActivationDialog } from "@/src/components/activation-dialog";
import { AgentOverviewMissions } from "@/src/components/agent-overview-missions";
import { AvailableMissionTypes } from "@/src/components/available-mission-types";
import { McpUrlOverrides } from "@/src/components/mcp-url-overrides";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentAvatar } from "@/components/opengroow/agent-avatar";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { Card, CardContent } from "@/components/ui/card";
import { AGENT_STATUS } from "@/components/opengroow/agent-presentation";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { TabNav } from "@/components/opengroow/tab-nav";

/** The Agent's merged state for this Project; `undefined` while loading. */
function useAgentCard(instanceId: string, manifest: AgentManifest) {
  const runtimeInstanceId = useRuntimeInstanceId(instanceId);
  const records = useQuery(
    api.project_agents.listByInstance,
    runtimeInstanceId ? { instanceId: runtimeInstanceId } : "skip",
  );
  const card = React.useMemo(
    () => (records === undefined ? undefined : mergeTemplatesWithAgents([manifest], records)[0]),
    [manifest, records],
  );
  return { runtimeInstanceId, card };
}

type Busy = "deactivate" | "delete" | "hidden";

function useAgentActions(runtimeInstanceId: string, templateId: string, agentsHref: string) {
  const router = useRouter();
  const deactivateAction = useAction(api.project_agents_node.deactivateProjectAgent);
  const deleteAction = useAction(api.project_agents_node.deleteProjectAgent);
  const reconfigureAction = useAction(api.project_agents_node.reconfigureProjectAgent);
  const applyHiddenMissionTypesAction = useAction(api.project_agents_node.applyHiddenMissionTypes);
  const [busy, setBusy] = React.useState<Busy | null>(null);
  const [error, setError] = React.useState<string | undefined>();

  async function run(
    kind: Busy,
    failure: string,
    work: () => Promise<{ status: string; errorMessage?: string } | void>,
  ): Promise<boolean> {
    if (!runtimeInstanceId) return false;
    setError(undefined);
    setBusy(kind);
    try {
      const result = await work();
      if (result && result.status === "error") {
        setError(result.errorMessage);
        return false;
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const target = { instanceId: runtimeInstanceId, templateId };
  return {
    busy,
    error,
    // An inactive Agent has no workspace-backed tabs, so leave its page for the list.
    deactivate: async () => {
      if (await run("deactivate", "Deactivation failed", () => deactivateAction(target))) router.push(agentsHref);
    },
    // Deletes the Agent and its whole history: the page no longer exists afterwards.
    remove: async () => {
      if (await run("delete", "Deletion failed", () => deleteAction(target))) router.push(agentsHref);
    },
    // Presentation only (ADR-053): the action stores the choice and syncs the
    // workspace so it carries only the instruction files of the types left visible.
    applyHiddenMissionTypes: (hiddenMissionTypes: string[]) =>
      run("hidden", "Saving hidden Mission types failed", () =>
        applyHiddenMissionTypesAction({ ...target, hiddenMissionTypes }),
      ),
    reconfigure: async (userConfig: Record<string, string>) => {
      const result = await reconfigureAction({ ...target, userConfig });
      if (result.status === "error") throw new Error(result.errorMessage);
    },
  };
}

export function AgentStatusBadge({ status }: { status: AgentCardState["status"] }) {
  return <StatusBadge tone={AGENT_STATUS[status].tone} label={AGENT_STATUS[status].label} />;
}

/**
 * Renders `children` with the manifest of an Agent's Template, read from
 * Convex. A Template the Project does not offer is a 404; nothing renders
 * while the manifest loads.
 */
function WithAgentManifest({
  instanceId,
  templateId,
  children,
}: {
  instanceId: string;
  templateId: string;
  children: (manifest: AgentManifest) => React.ReactNode;
}) {
  const manifest = useProjectManifest(instanceId, templateId);
  if (manifest === null) notFound();
  return manifest ? <>{children(manifest)}</> : null;
}

export function AgentPageLayout({
  instanceId,
  templateId,
  children,
}: {
  instanceId: string;
  templateId: string;
  children: React.ReactNode;
}) {
  return (
    <WithAgentManifest instanceId={instanceId} templateId={templateId}>
      {(manifest) => (
        <AgentPageFrame instanceId={instanceId} manifest={manifest}>
          {children}
        </AgentPageFrame>
      )}
    </WithAgentManifest>
  );
}

function AgentPageFrame({
  instanceId,
  manifest,
  children,
}: {
  instanceId: string;
  manifest: AgentManifest;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { card } = useAgentCard(instanceId, manifest);
  const base = `/projects/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(manifest.id)}`;
  // Files and Logs read the Agent's workspace, which only an active Agent has.
  const hasWorkspace = card?.status === "active" && card.workspaceKey !== undefined;
  const tabs = [
    { label: "Overview", href: base, enabled: true },
    { label: "Files", href: `${base}/files`, enabled: hasWorkspace },
    { label: "Logs", href: `${base}/logs`, enabled: hasWorkspace },
    { label: "Settings", href: `${base}/settings`, enabled: true },
  ];

  return (
    <section className="grid gap-6">
      <header className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <AgentAvatar name={manifest.name} category={manifest.category} />
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-3xl font-bold tracking-tight break-words text-foreground sm:text-4xl">
                  {manifest.name}
                </h1>
                {card ? <AgentStatusBadge status={card.status} /> : null}
              </div>
              <p className="m-0 max-w-2xl text-base leading-7 text-muted-foreground">{manifest.description}</p>
            </div>
          </div>
        </div>
        <TabNav items={tabs} current={pathname} label="Agent sections" />
      </header>
      {children}
    </section>
  );
}

function ErrorMessage({ message, link }: { message: string; link?: string }) {
  return (
    <p className="m-0 rounded-xl bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
      {message}
      {link ? (
        <>
          {" "}
          <a href={link} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            Open dashboard
          </a>
        </>
      ) : null}
    </p>
  );
}

export function AgentOverview({ instanceId, templateId }: { instanceId: string; templateId: string }) {
  return (
    <WithAgentManifest instanceId={instanceId} templateId={templateId}>
      {(manifest) => <AgentOverviewContent instanceId={instanceId} manifest={manifest} />}
    </WithAgentManifest>
  );
}

function AgentOverviewContent({ instanceId, manifest }: { instanceId: string; manifest: AgentManifest }) {
  const { runtimeInstanceId, card } = useAgentCard(instanceId, manifest);
  if (!card) return null;

  // Deactivate and Delete live in Settings, which shows their errors.
  // The MCP's dashboardUrl only goes with the persisted error (issue #320).
  const persistedError = card.status === "error" ? card.errorMessage : undefined;
  return (
    <div className="grid gap-6">
      {persistedError ? <ErrorMessage message={persistedError} link={card.errorLink} /> : null}
      <AgentOverviewMissions runtimeInstanceId={runtimeInstanceId} projectId={instanceId} manifest={manifest} />
    </div>
  );
}

export function AgentSettings({
  instanceId,
  templateId,
  selfHost = false,
}: {
  instanceId: string;
  templateId: string;
  /** Self-hosted deployment: enables the MCP URL override (#654). */
  selfHost?: boolean;
}) {
  return (
    <WithAgentManifest instanceId={instanceId} templateId={templateId}>
      {(manifest) => <AgentSettingsContent instanceId={instanceId} manifest={manifest} selfHost={selfHost} />}
    </WithAgentManifest>
  );
}

function AgentSettingsContent({
  instanceId,
  manifest,
  selfHost,
}: {
  instanceId: string;
  manifest: AgentManifest;
  selfHost: boolean;
}) {
  const { runtimeInstanceId, card } = useAgentCard(instanceId, manifest);
  const actions = useAgentActions(runtimeInstanceId, manifest.id, `/projects/${encodeURIComponent(instanceId)}/agents`);
  const [editing, setEditing] = React.useState(false);
  if (!card) return null;

  const active = card.status === "active";
  const missionTypes = manifest.missionTypes ?? [];
  const editable = active && hasEditableRequirements(manifest);
  const configurableMissionTypes = active && missionTypes.length > 1;
  const overridableMcpUrls = selfHost && manifest.mcpServers.length > 0;

  return (
    <div className="grid gap-5">
      {actions.error ? <ErrorMessage message={actions.error} /> : null}
      {!active ? (
        <p className="m-0 text-sm text-muted-foreground">
          Activate this Agent from the Agents list to configure it.
        </p>
      ) : null}
      {active && !editable && !configurableMissionTypes && !overridableMcpUrls ? (
        <p className="m-0 text-sm text-muted-foreground">
          Nothing to configure for this Agent: its configuration is fixed at activation and it offers at most one Mission type.
        </p>
      ) : null}
      {editable ? (
        <div>
          <Button variant="outline" size="lg" type="button" onClick={() => setEditing(true)}>
            <Pencil />
            Edit config
          </Button>
        </div>
      ) : null}
      {configurableMissionTypes ? (
        <AvailableMissionTypes
          missionTypes={missionTypes}
          hidden={card.hiddenMissionTypes}
          saving={actions.busy === "hidden"}
          onApply={(hidden) => void actions.applyHiddenMissionTypes(hidden)}
        />
      ) : null}
      {overridableMcpUrls ? (
        <McpUrlOverrides instanceId={instanceId} manifest={manifest} />
      ) : null}
      <AgentDangerZone
        name={manifest.name}
        active={active}
        busy={actions.busy}
        error={actions.error}
        onDeactivate={() => void actions.deactivate()}
        onDelete={() => void actions.remove()}
      />
      {editing ? (
        <ActivationDialog
          manifest={manifest}
          open
          title={`Edit config — ${manifest.name}`}
          submitLabel="Save"
          readOnlyKeys={immutableKeys(manifest)}
          initialValues={flatConfig(card.config)}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
          onSubmit={actions.reconfigure}
        />
      ) : null}
    </div>
  );
}

/**
 * Deactivate (reversible: the Agent leaves OpenClaw, its configuration and
 * history stay) and Delete (irreversible: the Agent, its Template, Schedules
 * and every Mission with its history), each confirmed in a dialog that says
 * what it does.
 */
function AgentDangerZone({
  name,
  active,
  busy,
  error,
  onDeactivate,
  onDelete,
}: {
  name: string;
  active: boolean;
  busy: Busy | null;
  error?: string;
  onDeactivate: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = React.useState<"deactivate" | "delete" | null>(null);
  const deactivating = busy === "deactivate";
  const deleting = busy === "delete";
  return (
    <Card data-slot="settings-panel" className="max-w-3xl" aria-label="Danger zone">
      <CardContent className="grid gap-6">
        <div className="flex items-start gap-4">
          <PanelIcon icon={TriangleAlert} tone="danger" />
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-foreground">Danger zone</h2>
            <p className="m-0 text-sm text-muted-foreground">Deactivate this Agent, or delete it with its whole history.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {active ? (
            <Button className="w-32" variant="outline" size="lg" type="button" disabled={busy !== null} onClick={() => setConfirming("deactivate")}>
              <Power />
              Deactivate
            </Button>
          ) : null}
          <Button className="w-32" variant="outline" size="lg" type="button" disabled={busy !== null} onClick={() => setConfirming("delete")}>
            <Trash2 />
            Delete
          </Button>
        </div>
        <Dialog open={confirming !== null} onOpenChange={(open) => !open && busy === null && setConfirming(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirming === "delete" ? `Delete ${name}?` : `Deactivate ${name}?`}</DialogTitle>
              <DialogDescription>
                {confirming === "delete"
                  ? "The Agent, its configuration, its Template, its Schedules and all its Missions with their Runs and publications are deleted. This cannot be undone."
                  : "This Agent will be deactivated. Its configuration and its Missions are kept, but it can no longer take new Missions until you activate it again."}
              </DialogDescription>
            </DialogHeader>
            {error && busy === null ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" type="button" disabled={busy !== null} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              {confirming === "delete" ? (
                <Button variant="destructive" type="button" loading={deleting} onClick={onDelete}>
                  {deleting ? null : <Trash2 />}
                  {deleting ? "Deleting…" : `Delete ${name}`}
                </Button>
              ) : (
                <Button type="button" loading={deactivating} onClick={onDeactivate}>
                  {deactivating ? null : <Power />}
                  {deactivating ? "Deactivating…" : "Deactivate"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
