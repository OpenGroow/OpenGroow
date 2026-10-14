"use client";

import Link from "next/link";
import * as React from "react";
import { use } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bot, Loader2, Plus } from "lucide-react";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import { hasRetryableStatusCheck } from "@convex/template_manifest_contract";
import { mergeTemplatesWithAgents, type AgentCardState } from "@/src/utils/merge-agent-states";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import type { InstanceRecord } from "@/src/components/instance-workspace.types";
import { ActivationDialog } from "@/src/components/activation-dialog";
import { AddAgentDialog } from "@/src/components/add-agent-dialog";
import { TemplateUpdatesPanel } from "@/src/components/template-updates-panel";
import { devActivationDefaults } from "@/src/utils/dev-activation-defaults";
import { flatConfig } from "@/src/utils/agent-requirements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Per-templateId message map with clear/set helpers. Shared by the activation
 * runtime-error banner and the Add Skill result banner — same "keyed message"
 * shape, different meaning per call site.
 */
// Shared by Activate/Retry (a Button) and Open (a Link) so they look the same.
// `bg-clip-border` lets the gradient run under the border: Button's default
// `bg-clip-padding` would leave a visible seam around it.
const CARD_ACTION_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[rgba(0,38,27,0.12)] bg-clip-border bg-[linear-gradient(135deg,rgba(188,237,215,0.96),rgba(227,242,234,0.98))] px-5 font-semibold text-[var(--dashboard-primary)] shadow-[0_8px_20px_rgba(0,38,27,0.10)] transition hover:border-[rgba(0,38,27,0.16)] hover:bg-[linear-gradient(135deg,rgba(174,230,205,1),rgba(214,236,226,1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,38,27,0.18)] focus-visible:ring-offset-2";

function useKeyedMessages() {
  const [messages, setMessages] = React.useState<Record<string, string>>({});

  function clear(key: string) {
    setMessages((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function set(key: string, message: string) {
    setMessages((prev) => ({ ...prev, [key]: message }));
  }

  return { messages, clear, set };
}

type InstanceAgentsPageProps = {
  params: Promise<{ instanceId: string }>;
  /** Self-hosted deployment (server-side flag): offers Add from a local folder. */
  selfHost?: boolean;
};

export function InstanceAgentsPage({ params, selfHost = false }: InstanceAgentsPageProps) {
  const { instanceId } = use(params);
  const decodedInstanceId = decodeURIComponent(instanceId);

  return <InstanceAgentsContent instanceId={decodedInstanceId} selfHost={selfHost} />;
}

type InstanceAgentsContentProps = {
  instanceId: string;
  selfHost?: boolean;
};

export function InstanceAgentsContent({
  instanceId: decodedInstanceId,
  selfHost = false,
}: InstanceAgentsContentProps) {
  const { manifests, loading: manifestsLoading } = useProjectManifests(decodedInstanceId);

  const instances = useAuthenticatedInstances<InstanceRecord>();
  const instance = instances?.find(
    (e) => e.openclawId === decodedInstanceId || e.jobId === decodedInstanceId,
  );
  const runtimeInstanceId = instance?.openclawId?.trim() ?? "";

  const agentRecords = useQuery(
    api.project_agents.listByInstance,
    runtimeInstanceId ? { instanceId: runtimeInstanceId } : "skip",
  );

  const activate = useAction(api.project_agents_node.activateProjectAgent);
  const addAgent = useAction(api.project_agents_node.addProjectAgent);
  const retryStatusCheck = useAction(api.project_agents_node.retryProjectAgentStatusCheck);

  const { messages: runtimeErrors, clear: clearError, set: setError } = useKeyedMessages();
  const [pendingActivationTemplateId, setPendingActivationTemplateId] = React.useState<string | null>(null);
  const [addAgentOpen, setAddAgentOpen] = React.useState(false);

  // Only Templates the Project already has an Agent of are cards; the others
  // are offered by the Add Agent catalogue.
  const cards: AgentCardState[] = React.useMemo(() => {
    const records = agentRecords ?? [];
    const added = new Set(records.map((record) => record.templateId));
    return mergeTemplatesWithAgents(manifests, records).filter((card) => added.has(card.templateId));
  }, [manifests, agentRecords]);

  async function handleAdd(templateId: string, userConfig: Record<string, string>) {
    if (!runtimeInstanceId) throw new Error("This Project's runtime is not ready yet.");
    const result = await addAgent({ instanceId: runtimeInstanceId, templateId, userConfig });
    if (result.status === "error") throw new Error(result.errorMessage);
  }

  function handleActivate(templateId: string, userConfig?: Record<string, string>) {
    if (!runtimeInstanceId) return;
    clearError(templateId);
    void activate({ instanceId: runtimeInstanceId, templateId, userConfig }).then((result) => {
      if (result.status === "error") {
        setError(templateId, result.errorMessage);
      }
    }).catch((err) => {
      setError(templateId, err instanceof Error ? err.message : "Activation failed");
    });
  }

  function handleActivateClick(card: AgentCardState) {
    const requirements = card.manifest.requirements ?? [];
    if (requirements.length > 0) {
      setPendingActivationTemplateId(card.templateId);
      return;
    }
    handleActivate(card.templateId);
  }

  function handleRetryStatusCheck(templateId: string) {
    if (!runtimeInstanceId) return;
    clearError(templateId);
    void retryStatusCheck({ instanceId: runtimeInstanceId, templateId }).then((result) => {
      if (result.status === "error") {
        setError(templateId, result.errorMessage);
      }
    }).catch((err) => {
      setError(templateId, err instanceof Error ? err.message : "Retry failed");
    });
  }

  function handleRetryClick(card: AgentCardState) {
    // Config Completeness (issue #320, ADR-034): a stored config.apiKey on an
    // errored Agent means the key was already accepted by the MCP the first
    // time — only the Project's own configuration was incomplete. Retry
    // re-runs just the status-check instead of re-prompting for the key
    // (falls back to reopening the activation form when there's no stored
    // key — the key itself was rejected). `hasRetryableStatusCheck` is the
    // exact same rule the backend action enforces — single source of truth.
    if (hasRetryableStatusCheck(card.manifest, card.config)) {
      handleRetryStatusCheck(card.templateId);
      return;
    }
    handleActivateClick(card);
  }

  const pendingActivationCard =
    pendingActivationTemplateId === null
      ? null
      : cards.find((card) => card.templateId === pendingActivationTemplateId) ?? null;

  if (!instance) return null;

  return (
    <section className="grid gap-8">
      <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
        <div className="grid gap-2">
          <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
            Agent Templates
          </span>
          <h1 className="m-0 text-[clamp(2.2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
            Agents
          </h1>
          <p className="m-0 max-w-3xl text-[1rem] leading-7 text-[var(--dashboard-ink-muted)]">
            Add agents from the catalogue. Each agent creates a dedicated workspace and wires up its MCP servers.
          </p>
        </div>
        <Button type="button" onClick={() => setAddAgentOpen(true)} className={CARD_ACTION_CLASS}>
          <Plus className="size-4" />
          Add Agent
        </Button>
      </header>

      {(agentRecords === undefined || manifestsLoading) && (
        <div className="flex items-center gap-3 text-[var(--dashboard-ink-muted)]">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading agent states…</span>
        </div>
      )}

      {agentRecords !== undefined && !manifestsLoading && cards.length === 0 && (
        <Card className="rounded-[1.7rem] border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))] py-5 shadow-[var(--dashboard-shadow)]">
          <CardContent className="grid gap-2 px-6">
            <h2 className="m-0 text-[1.15rem] leading-[1.08] tracking-[-0.03em] text-[var(--dashboard-ink)]">
              No agents yet
            </h2>
            <p className="m-0 text-[0.96rem] leading-7 text-[var(--dashboard-ink-muted)]">
              Use Add Agent to pick one from the catalogue.
            </p>
          </CardContent>
        </Card>
      )}

      {cards.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-2">
          {cards.map((card) => (
            <AgentCard
              key={card.templateId}
              card={card}
              instanceId={decodedInstanceId}
              runtimeError={runtimeErrors[card.templateId]}
              onActivate={() => (card.status === "error" ? handleRetryClick(card) : handleActivateClick(card))}
/>
          ))}
        </div>
      )}

      <TemplateUpdatesPanel projectId={decodedInstanceId} />

      <AddAgentDialog
        projectId={decodedInstanceId}
        instanceId={runtimeInstanceId || null}
        selfHost={selfHost}
        open={addAgentOpen}
        onOpenChange={setAddAgentOpen}
        onAdd={handleAdd}
      />

      {pendingActivationCard ? (
        <ActivationDialog
          manifest={pendingActivationCard.manifest}
          open
          initialValues={{
            ...devActivationDefaults(pendingActivationCard.templateId),
            // Reactivating a previously-configured Agent (e.g. after
            // deactivate) should show what's already stored, not force
            // retyping it — existing config wins over dev defaults.
            ...flatConfig(pendingActivationCard.config),
          }}
          onOpenChange={(open) => {
            if (!open) {
              setPendingActivationTemplateId(null);
            }
          }}
          onSubmit={async (userConfig) => {
            if (!runtimeInstanceId) return;
            clearError(pendingActivationCard.templateId);
            const result = await activate({
              instanceId: runtimeInstanceId,
              templateId: pendingActivationCard.templateId,
              userConfig,
            });
            if (result.status === "error") {
              setError(pendingActivationCard.templateId, result.errorMessage);
              throw new Error(result.errorMessage);
            }
          }}
        />
      ) : null}
    </section>
  );
}

type AgentCardProps = {
  card: AgentCardState;
  instanceId: string;
  runtimeError: string | undefined;
  onActivate: () => void;
};

function AgentCard({ card, instanceId, runtimeError, onActivate }: AgentCardProps) {
  const { manifest, status, errorMessage, errorLink } = card;
  const displayedError = runtimeError ?? (status === "error" ? errorMessage : undefined);
  // errorLink (Config Completeness, issue #320) only makes sense alongside
  // the persisted errorMessage — a runtime-only error (e.g. a network
  // failure calling the action) has no MCP dashboardUrl to show.
  const displayedErrorLink = status === "error" && !runtimeError ? errorLink : undefined;
  const agentHref = `/projects/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(card.templateId)}`;

  return (
    <Card className="rounded-[1.7rem] border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,245,0.86))] py-4 shadow-[var(--dashboard-shadow)]">
      <CardHeader className="grid gap-3 px-6 pb-0">
        <div className="flex items-center gap-3">
          <Bot className="size-5 shrink-0 text-[var(--dashboard-ink-soft)]" />
          <CardTitle className="text-[1.35rem] leading-[1.08] tracking-[-0.04em] text-[var(--dashboard-ink)]">
            {manifest.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 px-6 pt-5">
        <p className="m-0 text-[0.9375rem] leading-7 text-[var(--dashboard-ink-muted)]">
          {manifest.description}
        </p>

        {displayedError && (
          <p className="m-0 rounded-xl bg-[rgba(84,41,37,0.06)] px-4 py-3 text-[0.9rem] leading-6 text-[var(--dashboard-tertiary)]">
            {displayedError}
            {displayedErrorLink && (
              <>
                {" "}
                <a
                  href={displayedErrorLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline underline-offset-2"
                >
                  Open dashboard
                </a>
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {(status === "inactive" || status === "error") && (
            <Button
              type="button"
              onClick={onActivate}
              className={CARD_ACTION_CLASS}
            >
              {status === "error" ? "Retry" : "Activate"}
            </Button>
          )}

          {status === "activating" && (
            <Button type="button" disabled className="h-11 rounded-xl px-5">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Activating…
              </span>
            </Button>
          )}

          {status === "active" && (
            <Link href={agentHref} className={CARD_ACTION_CLASS}>
              Open
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
