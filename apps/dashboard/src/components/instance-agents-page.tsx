"use client";

import * as React from "react";
import { use } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
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
import { AgentsGallery } from "@/components/opengroow/agents-gallery";

/**
 * Per-templateId message map with clear/set helpers. Shared by the activation
 * runtime-error banner and the Add Skill result banner — same "keyed message"
 * shape, different meaning per call site.
 */
// Shared by Activate/Retry (a Button) and Open (a Link) so they look the same.
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
      <AgentsGallery
        cards={cards}
        loading={agentRecords === undefined || manifestsLoading}
        instanceId={decodedInstanceId}
        runtimeErrors={runtimeErrors}
        onAddAgent={() => setAddAgentOpen(true)}
        onActivate={(card) => (card.status === "error" ? handleRetryClick(card) : handleActivateClick(card))}
      />

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
