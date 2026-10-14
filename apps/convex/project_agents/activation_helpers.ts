import type { ActionCtx } from "../_generated/server.js";
import { openClawAgentSlug, type AgentTemplate, type ProjectAgentSkill } from "@opengroow/agent-templates";
import {
  RUNTIME_MCP_SERVERS_MERGE,
  type RuntimeMcpServersMergeResultPayload,
} from "@opengroow/protocol";
import { sendAndAwait } from "./runtime_calls.js";
import { provisionWorkspaceContent } from "./workspace_provisioning.js";
import { restartGatewayForPlugins } from "./template_plugins.js";
import type { ConfigCompletenessResult } from "./status_check.js";
import { upsertProjectAgentMutation } from "./shared_refs.js";
import { deepMergeRecords } from "./mcp_servers.js";

export type ActivationResult =
  | { status: "active"; workspaceKey: string; mcpServerKeys: string[] }
  | { status: "error"; errorMessage: string };

export type RefreshResult =
  | { status: "refreshed"; workspaceKey: string }
  | { status: "error"; errorMessage: string };

// Shared default when the MCP reports the Project as not-yet-configured but
// omits its own `message` (issue #320, ADR-034). OpenGroow never derives a
// provider-specific message — this is a generic fallback only.
const NOT_CONFIGURED_FALLBACK_MESSAGE =
  "The Project is not fully configured yet — finish setup in the MCP's dashboard.";

/**
 * Persist an `error` projectAgents record for a failed Config Completeness
 * status-check (issue #320, ADR-034) and return the matching ActivationResult.
 * Shared by first activation and Retry so both classify `key_rejected` /
 * `not_configured` identically. `configToPersist` is written only on the
 * `not_configured` branch (the key was accepted, so it is stored for Retry to
 * reuse); a `key_rejected` outcome never persists the key.
 */
export async function persistStatusCheckFailure(
  ctx: ActionCtx,
  args: {
    instanceId: string;
    templateId: string;
    completeness: Extract<ConfigCompletenessResult, { outcome: "key_rejected" | "not_configured" }>;
    configToPersist?: Record<string, unknown>;
  },
): Promise<{ status: "error"; errorMessage: string }> {
  const { instanceId, templateId, completeness, configToPersist } = args;
  const errorMessage =
    completeness.outcome === "key_rejected" ? completeness.message : completeness.message ?? NOT_CONFIGURED_FALLBACK_MESSAGE;
  const errorLink = completeness.outcome === "not_configured" ? completeness.dashboardUrl : undefined;
  await ctx.runMutation(upsertProjectAgentMutation, {
    instanceId,
    templateId,
    status: "error",
    errorMessage,
    errorLink,
    // configToPersist is only ever passed on the not_configured branch (the
    // key was accepted) — a key_rejected outcome never persists the key.
    config: configToPersist,
  });
  return { status: "error", errorMessage };
}

/**
 * Persist an `error` projectAgents record for an unexpected exception (workspace
 * creation failed, MCP merge failed, template misconfigured, etc.) and return
 * the matching ActivationResult. Shared by `activateProjectAgent`'s and
 * `retryProjectAgentStatusCheck`'s outermost catch blocks.
 */
export async function persistUnexpectedError(
  ctx: ActionCtx,
  instanceId: string,
  templateId: string,
  error: unknown,
): Promise<{ status: "error"; errorMessage: string }> {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  await ctx.runMutation(upsertProjectAgentMutation, {
    instanceId,
    templateId,
    status: "error",
    errorMessage,
  });
  return { status: "error", errorMessage };
}

/**
 * Merges the Template's MCP servers into the Instance's runtime config
 * (`openclaw.json`) and returns the merged keys. Re-applies the per-server
 * Authorization header from the frozen apiKey on EVERY merge (ADR-021):
 * resolveMcpServers strips manifest `headers`, so this patch is the only path
 * that carries the header to openclaw.json. Used by activation and when a
 * self-host MCP URL override changes (#654).
 */
export async function mergeRuntimeMcpServers(
  ctx: ActionCtx,
  instanceId: string,
  template: AgentTemplate,
  mcpServers: Record<string, Record<string, unknown>>,
  agentConfig: Record<string, unknown> | undefined,
): Promise<string[]> {
  let serversToMerge = mcpServers;
  const resolvedApiKey = String((agentConfig ?? {}).apiKey ?? "");
  if (resolvedApiKey) {
    const authPatch: Record<string, Record<string, unknown>> = {};
    for (const server of template.manifest.mcpServers) {
      authPatch[server.name] = { headers: { Authorization: `Bearer ${resolvedApiKey}` } };
    }
    serversToMerge = deepMergeRecords(serversToMerge, authPatch);
  }
  if (Object.keys(serversToMerge).length === 0) return [];

  const mergeResult = await sendAndAwait(ctx, instanceId, RUNTIME_MCP_SERVERS_MERGE, {
    servers: serversToMerge,
  });
  const mergePayload = mergeResult.payload as RuntimeMcpServersMergeResultPayload | undefined;
  if (!mergeResult.found || !mergePayload?.ok) {
    throw new Error(mergePayload?.error ?? "MCP merge failed");
  }
  return mergePayload.data?.mergedKeys ?? [];
}

/**
 * Shared activation tail: apply the per-server Authorization header from the
 * frozen apiKey, merge the MCP servers, provision workspace content (AGENTS.md
 * plus native OpenClaw agent registration), and flip the Agent to
 * `active`. Used by both first activation and the Config Completeness Retry
 * path (issue #320, ADR-034) so an Agent only ever reaches `active` fully
 * provisioned — Retry must never shortcut straight to `active` without this,
 * or the Agent would look active while guaranteed to fail on its first Mission.
 */
export async function provisionAndActivate(
  ctx: ActionCtx,
  args: {
    instanceId: string;
    templateId: string;
    template: AgentTemplate;
    workspaceKey: string;
    knownWorkspaceAbsolutePath: string | undefined;
    mcpServers: Record<string, Record<string, unknown>>;
    activateConfig: Record<string, unknown> | undefined;
    /** Mission types the operator hid before this (re)activation (ADR-053). */
    hiddenMissionTypes?: readonly string[];
    existingSkills: ProjectAgentSkill[];
  },
): Promise<ActivationResult> {
  const {
    instanceId,
    templateId,
    template,
    workspaceKey,
    knownWorkspaceAbsolutePath,
    mcpServers,
    activateConfig,
    existingSkills,
  } = args;

  const mcpServerKeys = await mergeRuntimeMcpServers(ctx, instanceId, template, mcpServers, activateConfig);

  const provisioned = await provisionWorkspaceContent(ctx, {
    instanceId,
    templateId,
    workspaceKey,
    knownWorkspaceAbsolutePath,
    template,
    agentConfig: activateConfig,
    hiddenMissionTypes: args.hiddenMissionTypes,
    existingSkills,
    clearOpenClawDefaults: true,
    upsertMutation: upsertProjectAgentMutation,
  });
  if (provisioned.status === "error") {
    return provisioned;
  }

  await ctx.runMutation(upsertProjectAgentMutation, {
    instanceId,
    templateId,
    status: "active",
    workspaceKey,
    openclawAgentName: openClawAgentSlug(templateId),
    mcpServerKeys,
    config: activateConfig,
    skills: provisioned.skills,
  });

  // Last runtime call: the Instance is unreachable while the Gateway restarts.
  if (provisioned.pluginsChanged) await restartGatewayForPlugins(ctx, instanceId);

  return { status: "active", workspaceKey, mcpServerKeys };
}
