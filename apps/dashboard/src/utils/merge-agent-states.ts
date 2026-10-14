import type { AgentManifest } from "@convex/template_manifest_contract";
import type { ProjectAgentSkill } from "@convex/template_manifest_contract";

export type AgentCardState = {
  templateId: string;
  manifest: AgentManifest;
  status: "inactive" | "activating" | "active" | "error";
  workspaceKey?: string;
  errorMessage?: string;
  // Config Completeness (issue #320, ADR-034): carries the MCP's own
  // dashboardUrl when a statusCheck-gated Activation reports the Project as
  // not yet configured, so the error banner can render a real link.
  errorLink?: string;
  config?: Record<string, unknown>;
  skills?: ProjectAgentSkill[];
  /** Mission types the operator hides from this Agent (ADR-053). */
  hiddenMissionTypes?: string[];
};

type ProjectAgentRecord = {
  templateId: string;
  status: "inactive" | "activating" | "active" | "error";
  workspaceKey?: string;
  errorMessage?: string;
  errorLink?: string;
  mcpServerKeys: string[];
  config?: Record<string, unknown>;
  skills?: ProjectAgentSkill[];
  hiddenMissionTypes?: string[];
};

export function mergeTemplatesWithAgents(
  manifests: AgentManifest[],
  agents: ProjectAgentRecord[],
): AgentCardState[] {
  const agentsByTemplate = new Map<string, ProjectAgentRecord>();
  for (const agent of agents) {
    agentsByTemplate.set(agent.templateId, agent);
  }

  return manifests.map((manifest) => {
    const record = agentsByTemplate.get(manifest.id);
    if (!record) {
      return { templateId: manifest.id, manifest, status: "inactive" };
    }
    return {
      templateId: manifest.id,
      manifest,
      status: record.status,
      workspaceKey: record.workspaceKey,
      errorMessage: record.errorMessage,
      errorLink: record.errorLink,
      config: record.config,
      skills: record.skills,
      hiddenMissionTypes: record.hiddenMissionTypes,
    };
  });
}
