import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import type { FunctionReference } from "convex/server";
import type { ProjectAgentSkill } from "@opengroow/agent-templates";

export type StoredProjectAgent = {
  templateId: string;
  workspaceKey?: string;
  /** Name of the agent registered in OpenClaw (the derived slug once migrated). */
  openclawAgentName?: string;
  status: string;
  mcpServerKeys: string[];
  config?: Record<string, unknown>;
  skills?: ProjectAgentSkill[];
  /** Mission types the operator hides from this Agent (ADR-053). */
  hiddenMissionTypes?: string[];
};

export type StoredInstanceOwner = {
  ownerId?: string;
};

// Break circular type inference between generated api and local action declarations.
export const getUniqueInstanceByOpenclawIdQuery = internal.instances
  .getUniqueByOpenclawId as unknown as FunctionReference<
  "query",
  "internal",
  { openclawId: string },
  StoredInstanceOwner | null
>;

export const getByInstanceAndTemplateQuery = internal.project_agents
  .getByInstanceAndTemplate as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; templateId: string },
  StoredProjectAgent | null
>;

export const upsertProjectAgentMutation = internal.project_agents
  .upsert as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    instanceId: string;
    templateId: string;
    status: string;
    workspaceKey?: string;
    openclawAgentName?: string;
    mcpServerKeys?: string[];
    errorMessage?: string;
    errorLink?: string;
    config?: Record<string, unknown>;
    skills?: ProjectAgentSkill[];
  },
  Id<"projectAgents">
>;

export const claimNewProjectAgentMutation = internal.project_agents
  .claimNew as unknown as FunctionReference<
  "mutation",
  "internal",
  { instanceId: string; templateId: string },
  boolean
>;

// Dedicated find-or-replace mutation for a single skill entry (issue #224).
// Unlike `upsertProjectAgentMutation`, this re-reads `skills[]` inside its
// own transaction instead of writing an array computed from a pre-install
// snapshot — see `upsertAgentSkill` in project_agents.ts for why that
// matters across the slow `clawhub install` await in `addAgentSkill` below.
export const upsertAgentSkillMutation = internal.project_agents
  .upsertAgentSkill as unknown as FunctionReference<
  "mutation",
  "internal",
  { instanceId: string; templateId: string; skill: ProjectAgentSkill },
  { status: "ok" | "not_found" }
>;

export const listActiveByInstanceQuery = internal.project_agents
  .listActiveByInstance as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string },
  StoredProjectAgent[]
>;

export const countActiveRunsByInstanceTemplateQuery = internal.runs
  .countActiveByInstanceTemplate as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; templateId: string },
  number
>;

export const markInactiveIfNoActiveRunsMutation = internal.project_agents
  .markInactiveIfNoActiveRuns as unknown as FunctionReference<
  "mutation",
  "internal",
  { instanceId: string; templateId: string },
  { ok: true } | { ok: false; count: number }
>;
