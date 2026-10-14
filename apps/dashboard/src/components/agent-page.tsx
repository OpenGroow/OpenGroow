"use client";

import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import type { AgentManifest } from "@convex/template_manifest_contract";
import { mergeTemplatesWithAgents, type AgentCardState } from "@/src/utils/merge-agent-states";
import { flatConfig, hasEditableRequirements, immutableKeys } from "@/src/utils/agent-requirements";
import { useProjectManifest } from "@/src/hooks/use-project-manifests";
import { useRuntimeInstanceId } from "@/src/hooks/use-runtime-instance-id";
import { ActivationDialog } from "@/src/components/activation-dialog";
import { AvailableMissionTypes } from "@/src/components/available-mission-types";
import { McpUrlOverrides } from "@/src/components/mcp-url-overrides";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

const STATUS_LABELS: Record<AgentCardState["status"], string> = {
  inactive: "Inactive",
  activating: "Activating",
  active: "Active",
  error: "Error",
};

const STATUS_STYLES: Record<AgentCardState["status"], string> = {
  inactive: "bg-[rgba(220,230,224,0.5)] text-[var(--dashboard-ink-soft)]",
  active: "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]",
  activating: "bg-[rgba(220,230,224,0.7)] text-[var(--dashboard-ink-soft)]",
  error: "bg-[rgba(84,41,37,0.08)] text-[var(--dashboard-tertiary)]",
};

const SECONDARY_BUTTON =
  "h-11 rounded-xl border border-[rgba(0,38,27,0.12)] bg-white px-5 font-semibold text-[var(--dashboard-ink)] hover:bg-[rgba(220,230,224,0.5)]";

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

type Busy = "refresh" | "deactivate" | "hidden";

function useAgentActions(runtimeInstanceId: string, templateId: string, agentsHref: string) {
  const router = useRouter();
  const refreshAction = useAction(api.project_agents_node.refreshProjectAgent);
  const deactivateAction = useAction(api.project_agents_node.deactivateProjectAgent);
  const reconfigureAction = useAction(api.project_agents_node.reconfigureProjectAgent);
  const setHiddenMissionTypes = useMutation(api.project_agents.setHiddenMissionTypes);
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
    refresh: () => run("refresh", "Refresh failed", () => refreshAction(target)),
    // An inactive Agent has no workspace-backed tabs, so leave its page for the list.
    deactivate: async () => {
      if (await run("deactivate", "Deactivation failed", () => deactivateAction(target))) router.push(agentsHref);
    },
    // Presentation only (ADR-053): store the choice, then refresh so the
    // workspace carries only the instruction files of the types left visible.
    applyHiddenMissionTypes: (hiddenMissionTypes: string[]) =>
      run("hidden", "Saving hidden Mission types failed", async () => {
        await setHiddenMissionTypes({ ...target, hiddenMissionTypes });
        return refreshAction(target);
      }),
    reconfigure: async (userConfig: Record<string, string>) => {
      const result = await reconfigureAction({ ...target, userConfig });
      if (result.status === "error") throw new Error(result.errorMessage);
    },
  };
}

export function AgentStatusBadge({ status }: { status: AgentCardState["status"] }) {
  return <StatusPill label={STATUS_LABELS[status]} className={STATUS_STYLES[status]} />;
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
    { label: "Settings", href: `${base}/settings`, enabled: true },
    { label: "Files", href: `${base}/files`, enabled: hasWorkspace },
    { label: "Logs", href: `${base}/logs`, enabled: hasWorkspace },
  ];

  return (
    <section className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[clamp(1.8rem,3vw,2.6rem)] leading-[1.02] tracking-[-0.05em] text-[var(--dashboard-primary)]">
            {manifest.name}
          </h1>
          {card ? <AgentStatusBadge status={card.status} /> : null}
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Agent sections">
          {tabs.map((tab) =>
            tab.enabled ? (
              <Link
                key={tab.label}
                href={tab.href}
                aria-current={pathname === tab.href ? "page" : undefined}
                className={`rounded-full px-4 py-1.5 text-[0.9rem] font-semibold ${
                  pathname === tab.href
                    ? "bg-[rgba(188,237,215,0.7)] text-[var(--dashboard-primary)]"
                    : "text-[var(--dashboard-ink-muted)] hover:bg-[rgba(220,230,224,0.5)]"
                }`}
              >
                {tab.label}
              </Link>
            ) : (
              <span
                key={tab.label}
                aria-disabled="true"
                className="cursor-not-allowed rounded-full px-4 py-1.5 text-[0.9rem] font-semibold text-[var(--dashboard-ink-muted)] opacity-40"
              >
                {tab.label}
              </span>
            ),
          )}
        </nav>
      </header>
      {children}
    </section>
  );
}

function ErrorMessage({ message, link }: { message: string; link?: string }) {
  return (
    <p className="m-0 rounded-xl bg-[rgba(84,41,37,0.06)] px-4 py-3 text-[0.9rem] leading-6 text-[var(--dashboard-tertiary)]">
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

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </span>
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
  const actions = useAgentActions(runtimeInstanceId, manifest.id, `/projects/${encodeURIComponent(instanceId)}/agents`);
  if (!card) return null;

  const persistedError = card.status === "error" ? card.errorMessage : undefined;
  const message = actions.error ?? persistedError;
  // The MCP's dashboardUrl only goes with the persisted error (issue #320).
  const link = !actions.error && card.status === "error" ? card.errorLink : undefined;

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-3xl text-[0.9375rem] leading-7 text-[var(--dashboard-ink-muted)]">
        {manifest.description}
      </p>
      {manifest.mcpServers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {manifest.mcpServers.map((server) => (
            <span
              key={server.name}
              className="rounded-full bg-[rgba(0,38,27,0.05)] px-3 py-1 text-[0.8rem] text-[var(--dashboard-ink-muted)]"
            >
              {server.name}
            </span>
          ))}
        </div>
      )}
      {message ? <ErrorMessage message={message} link={link} /> : null}
      {card.status === "active" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={actions.busy === "refresh"} onClick={() => void actions.refresh()} className={SECONDARY_BUTTON}>
            {actions.busy === "refresh" ? (
              <Spinner label="Refreshing…" />
            ) : (
              <span className="flex items-center gap-2">
                <RefreshCw className="size-4" />
                Refresh
              </span>
            )}
          </Button>
          <Button type="button" disabled={actions.busy === "deactivate"} onClick={() => void actions.deactivate()} className={SECONDARY_BUTTON}>
            {actions.busy === "deactivate" ? <Spinner label="Deactivating…" /> : "Deactivate"}
          </Button>
        </div>
      ) : null}
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
        <p className="m-0 text-[0.9rem] text-[var(--dashboard-ink-muted)]">
          Activate this Agent from the Agents list to configure it.
        </p>
      ) : null}
      {active && !editable && !configurableMissionTypes && !overridableMcpUrls ? (
        <p className="m-0 text-[0.9rem] text-[var(--dashboard-ink-muted)]">
          Nothing to configure for this Agent: its configuration is fixed at activation and it offers at most one Mission type.
        </p>
      ) : null}
      {editable ? (
        <div>
          <Button type="button" onClick={() => setEditing(true)} className={SECONDARY_BUTTON}>
            <span className="flex items-center gap-2">
              <Pencil className="size-4" />
              Edit config
            </span>
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
