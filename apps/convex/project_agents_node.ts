"use node";

import { randomUUID } from "node:crypto";
import { action, internalAction, type ActionCtx } from "./_generated/server.js";
import { v, type ObjectType } from "convex/values";
import {
  flattenRequirementFields,
  isTemplateVisible,
  executeActivationEffect,
  deriveConfigIdKey,
  findSkillByKey,
  openClawAgentSlug,
  type ProjectAgentSkill,
} from "@opengroow/agent-templates";
import {
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_MCP_SERVERS_REMOVE,
  type RuntimeWorkspaceCreateResultPayload,
  type RuntimeMcpServersRemoveResultPayload,
} from "@opengroow/protocol";
import { env } from "./env";
import { getTemplateRegistry } from "./template_registry.js";
import { sendAndAwait } from "./project_agents/runtime_calls.js";
import {
  deleteNativeOpenClawAgent,
  deliverRequirementToInstance,
  installClawhubSkill,
  provisionWorkspaceContent,
  resolveWorkspaceAbsolutePath,
} from "./project_agents/workspace_provisioning.js";
import { restartGatewayForPlugins } from "./project_agents/template_plugins.js";
import { checkConfigCompleteness } from "./project_agents/status_check.js";
import {
  claimNewProjectAgentMutation,
  getByInstanceAndTemplateQuery,
  upsertProjectAgentMutation,
  upsertAgentSkillMutation,
  listActiveByInstanceQuery,
  countActiveRunsByInstanceTemplateQuery,
  markInactiveIfNoActiveRunsMutation,
} from "./project_agents/shared_refs.js";
import { requireAuthenticatedUser, requireInstanceOwner } from "./project_agents/auth.js";
import { resolveMcpServers } from "./project_agents/mcp_servers.js";
import {
  type ActivationResult,
  type RefreshResult,
  persistStatusCheckFailure,
  mergeRuntimeMcpServers,
  persistUnexpectedError,
  provisionAndActivate,
} from "./project_agents/activation_helpers.js";

export function canActivateAgent(_instanceId: string): boolean {
  return true;
}

const activationArgs = {
  instanceId: v.string(),
  templateId: v.string(),
  userConfig: v.optional(v.record(v.string(), v.any())),
};

export const activateProjectAgent = action({
  args: activationArgs,
  handler: async (ctx, args): Promise<ActivationResult> => await activateAgent(ctx, args),
});

/**
 * "Add Agent" (#655): the single confirmed gesture of the catalogue. A Project
 * holds at most one Agent per Template, so a Template the Project already has
 * an Agent of (whatever its status) is refused; reactivating that Agent goes
 * through `activateProjectAgent`. The Template is already in the Project's
 * registry (built-in, or installed from a folder), so adding is the activation.
 */
export const addProjectAgent = action({
  args: activationArgs,
  handler: async (ctx, args): Promise<ActivationResult> => await activateAgent(ctx, args, { newAgentOnly: true }),
});

type ActivationArgs = ObjectType<typeof activationArgs>;

function alreadyAddedError(templateId: string): ActivationResult {
  return { status: "error", errorMessage: `This Project already has an Agent of Template ${templateId}` };
}

/**
 * With `newAgentOnly`, refuses a Template the Project already has an Agent of:
 * checked up front (so an existing Agent's record is never touched), then
 * atomically when the "activating" record is created, so concurrent adds
 * cannot both provision.
 */
async function activateAgent(
  ctx: ActionCtx,
  args: ActivationArgs,
  { newAgentOnly = false }: { newAgentOnly?: boolean } = {},
): Promise<ActivationResult> {
  const { instanceId, templateId, userConfig } = args;

  const user = await requireAuthenticatedUser(ctx);
  const ownership = await requireInstanceOwner(ctx, instanceId, user);
  if (!ownership.ok) {
    return { status: "error", errorMessage: ownership.errorMessage };
  }

  if (!canActivateAgent(instanceId)) {
    return { status: "error", errorMessage: "Agent activation not allowed" };
  }

  if (newAgentOnly && (await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId }))) {
    return alreadyAddedError(templateId);
  }

  try {
    const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }
    if (!isTemplateVisible(template.manifest, { includeDevelopment: env.OPENGROOW_ENABLE_DEMO_AGENTS })) {
      throw new Error(`Template not available: ${templateId}`);
    }
    const missingRequiredField = flattenRequirementFields(template.manifest.requirements).find(
      (field) => field.required && isMissingRequiredUserConfigValue(userConfig?.[field.key]),
    );
    if (missingRequiredField) {
      return {
        status: "error",
        errorMessage: `Missing required field: ${missingRequiredField.key}`,
      };
    }
    const { servers: mcpServers, activationUrls } = resolveMcpServers(template);

    if (newAgentOnly) {
      if (!(await ctx.runMutation(claimNewProjectAgentMutation, { instanceId, templateId }))) {
        return alreadyAddedError(templateId);
      }
    } else {
      await ctx.runMutation(upsertProjectAgentMutation, {
        instanceId,
        templateId,
        status: "activating",
      });
    }

    const existing = await ctx.runQuery(getByInstanceAndTemplateQuery, {
      instanceId,
      templateId,
    });

    const isNewWorkspace = !existing?.workspaceKey;
    let workspaceKey: string = existing?.workspaceKey ?? randomUUID();

    const createResult = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_CREATE, {
      workspaceKey,
      label: templateId,
    });
    const createPayload = createResult.payload as RuntimeWorkspaceCreateResultPayload | undefined;
    if (!createResult.found || !createPayload?.ok) {
      throw new Error(createPayload?.error ?? "Workspace creation failed");
    }
    workspaceKey = createPayload.data.workspaceKey || workspaceKey;
    const workspaceAbsolutePath: string | undefined = createPayload.data.absolutePath;

    // Persist workspaceKey immediately so retries reuse the same workspace
    // instead of creating a new orphaned one on each failed activation.
    await ctx.runMutation(upsertProjectAgentMutation, {
      instanceId,
      templateId,
      status: "activating",
      workspaceKey,
    });

    let activateConfig: Record<string, unknown> | undefined;
    const activationEffect = template.manifest.activation;
    const statusCheckContract = template.manifest.statusCheck;

    // Config Completeness gate (issue #320, ADR-034): when the Template
    // declares a statusCheck contract, the MCP owns Project config
    // end-to-end — OpenGroow only stores the apiKey and asks the MCP
    // whether the Project it identifies is fully configured on its own
    // side. The Agent only reaches `active` when the MCP reports
    // `configured: true`.
    if (statusCheckContract) {
      const submittedApiKey = String((userConfig ?? {}).apiKey ?? existing?.config?.apiKey ?? "");
      const completeness = await checkConfigCompleteness(template, statusCheckContract, submittedApiKey);
      // The key was accepted by the MCP as soon as the call didn't reject
      // it — merge it into the persisted config on both the `configured`
      // and `not_configured` outcomes, so a Retry (issue #320, point 5) can
      // reuse it without re-prompting. A `key_rejected` outcome never
      // persists the key: the user must re-open the activation form.
      const acceptedConfig = { ...existing?.config, apiKey: submittedApiKey };
      if (completeness.outcome !== "configured") {
        // No MCP-merge/provisioning work follows in either failure case.
        return await persistStatusCheckFailure(ctx, {
          instanceId,
          templateId,
          completeness,
          configToPersist: completeness.outcome === "not_configured" ? acceptedConfig : undefined,
        });
      }
      activateConfig = acceptedConfig;
    } else {
      // Run the declarative activation effect only when the template declares
      // one AND the resource id is not already stored (i.e. first-time
      // provisioning). The config id key is DERIVED from the body tree
      // (ADR-021, point 3 & 5): whichever key holds a {responseId} leaf is
      // the frozen id key — no hard-coded names.
      const derivedConfigIdKey = activationEffect ? deriveConfigIdKey(activationEffect.body) : undefined;
      const existingConfigIdValue = derivedConfigIdKey ? existing?.config?.[derivedConfigIdKey] : undefined;
      if (activationEffect && typeof existingConfigIdValue !== "string") {
        const serverName = activationEffect.server;
        const serverUrl = activationUrls[serverName];
        if (!serverUrl) {
          throw new Error(`Cannot activate template ${templateId}: no URL found for MCP server ${serverName}`);
        }
        const apiKey = String((userConfig ?? {}).apiKey ?? "");
        const origin = new URL(serverUrl).origin;
        const effectResult = await executeActivationEffect(
          activationEffect,
          userConfig ?? {},
          existing?.config ?? {},
          origin,
          apiKey,
        );
        activateConfig = effectResult.config;
      } else if (activationEffect) {
        // Re-activation of an effect-based template (e.g. seo, video) whose
        // resource id is already stored: freeze the existing config as-is —
        // apiKey and the derived id must not change on re-activation (ADR-021).
        activateConfig = existing?.config;
      } else if (userConfig || existing?.config) {
        // No declarative activation effect (e.g. a plain `reconfigurable`
        // template): merge the freshly submitted
        // userConfig over whatever was already stored, so re-activating an
        // Agent after deactivate persists the new values instead of
        // silently discarding them in favor of the stale config.
        activateConfig = { ...existing?.config, ...userConfig };
      }
    }

    return await provisionAndActivate(ctx, {
      instanceId,
      templateId,
      template,
      workspaceKey,
      knownWorkspaceAbsolutePath: workspaceAbsolutePath,
      mcpServers,
      activateConfig,
      hiddenMissionTypes: existing?.hiddenMissionTypes,
      existingSkills: existing?.skills ?? [],
    });
  } catch (error) {
    return await persistUnexpectedError(ctx, instanceId, templateId, error);
  }
}

/**
 * Re-runs only the Config Completeness status-check for an Agent already in
 * `error` (issue #320, ADR-034) — it does not ask for the apiKey again, since
 * a stored `config.apiKey` means the key was already accepted by the MCP the
 * first time (only a `configured: false` Project was pending). If the key
 * itself was the problem, `config.apiKey` is never persisted (see
 * `activateProjectAgent`), so this action has nothing to retry with and
 * reports an error telling the caller to reactivate with a corrected key.
 */
export const retryProjectAgentStatusCheck = action({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
  },
  handler: async (ctx, args): Promise<ActivationResult> => {
    const { instanceId, templateId } = args;

    const user = await requireAuthenticatedUser(ctx);
    const ownership = await requireInstanceOwner(ctx, instanceId, user);
    if (!ownership.ok) {
      return { status: "error", errorMessage: ownership.errorMessage };
    }

    const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
    if (!template) {
      return { status: "error", errorMessage: `Template not found: ${templateId}` };
    }
    const statusCheckContract = template.manifest.statusCheck;
    if (!statusCheckContract) {
      return { status: "error", errorMessage: `Template ${templateId} has no status check` };
    }

    const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
    if (!agent) {
      return { status: "error", errorMessage: "Agent not found" };
    }
    const apiKey = String(agent.config?.apiKey ?? "");
    if (!apiKey) {
      return {
        status: "error",
        errorMessage: "No API key on file for this Agent — reactivate it with a new key",
      };
    }

    const completeness = await checkConfigCompleteness(template, statusCheckContract, apiKey);
    if (completeness.outcome !== "configured") {
      // Re-classify the same way first activation does. The key is never
      // re-persisted here — it was already accepted the first time (a stored
      // config.apiKey is the precondition for reaching this action).
      return await persistStatusCheckFailure(ctx, { instanceId, templateId, completeness });
    }

    if (!agent.workspaceKey) {
      return {
        status: "error",
        errorMessage: "Agent workspace not found — reactivate it with a new key",
      };
    }

    // The Project is now fully configured on the MCP's side: run the SAME
    // provisioning tail as a first activation so the Agent only reaches
    // `active` with its MCP servers merged (Authorization header applied),
    // workspace files written, and the native OpenClaw agent registered (issue
    // #320, ADR-034). A bare status flip would leave the Agent `active` but
    // guaranteed to fail on its first Mission — the exact gap this issue closes.
    try {
      const { servers: mcpServers } = resolveMcpServers(template);
      return await provisionAndActivate(ctx, {
        instanceId,
        templateId,
        template,
        workspaceKey: agent.workspaceKey,
        // Like refresh, Retry never learns the workspace's absolute path from
        // an earlier step — provisionWorkspaceContent resolves it itself.
        knownWorkspaceAbsolutePath: undefined,
        mcpServers,
        activateConfig: agent.config,
        hiddenMissionTypes: agent.hiddenMissionTypes,
        existingSkills: agent.skills ?? [],
      });
    } catch (error) {
      return await persistUnexpectedError(ctx, instanceId, templateId, error);
    }
  },
});

/**
 * Brings an active Agent's workspace in line with the Project's registry:
 * workspace files (minus hidden Mission types) and declared skills. Shared by
 * the dashboard's refresh and by reconciliation (after an install, after the
 * Instance is reprovisioned).
 *
 * `ensureWorkspace` first re-creates the workspace under its stored key (an
 * idempotent runtime command, as activation does): a reprovisioned Instance
 * no longer has it.
 */
async function refreshFromRegistry(
  ctx: ActionCtx,
  instanceId: string,
  templateId: string,
  options: { ensureWorkspace: boolean },
): Promise<RefreshResult & { pluginsChanged?: boolean }> {
  try {
    const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
    if (!agent) {
      return { status: "error", errorMessage: "Agent not found" };
    }
    if (agent.status !== "active") {
      return { status: "error", errorMessage: "Agent must be active to refresh" };
    }
    if (!agent.workspaceKey) {
      return { status: "error", errorMessage: "Agent workspace not found" };
    }

    const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let knownWorkspaceAbsolutePath: string | undefined;
    if (options.ensureWorkspace) {
      const created = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_CREATE, {
        workspaceKey: agent.workspaceKey,
        label: templateId,
      });
      const createPayload = created.payload as RuntimeWorkspaceCreateResultPayload | undefined;
      if (!created.found || !createPayload?.ok) {
        throw new Error(createPayload?.error ?? "Workspace creation failed");
      }
      knownWorkspaceAbsolutePath = createPayload.data.absolutePath;
    }

    const provisioned = await provisionWorkspaceContent(ctx, {
      instanceId,
      templateId,
      workspaceKey: agent.workspaceKey,
      // Unlike activation, a plain refresh never learns the workspace's
      // absolute path as a side effect of an earlier step.
      knownWorkspaceAbsolutePath,
      template,
      agentConfig: agent.config,
      hiddenMissionTypes: agent.hiddenMissionTypes,
      existingSkills: agent.skills ?? [],
      // Container restarts re-seed OpenClaw's default files from
      // /opt/workspace-templates (entrypoint.sh's `cp -rn`), so a refresh
      // must clear them again — deleting an already-absent file is a no-op
      // (ENOENT is handled by deleteWorkspaceFile).
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
      skills: provisioned.skills,
      // Registered (under the derived slug) just above, with the workspace
      // untouched: only now does the Agent switch over to the new id.
      openclawAgentName: openClawAgentSlug(templateId),
    });

    return { status: "refreshed", workspaceKey: agent.workspaceKey, pluginsChanged: provisioned.pluginsChanged };
  } catch (error) {
    return {
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export const refreshProjectAgent = action({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
  },
  handler: async (ctx, args): Promise<RefreshResult> => {
    const { instanceId, templateId } = args;

    const user = await requireAuthenticatedUser(ctx);
    const ownership = await requireInstanceOwner(ctx, instanceId, user);
    if (!ownership.ok) {
      return { status: "error", errorMessage: ownership.errorMessage };
    }

    const { pluginsChanged, ...result } = await refreshFromRegistry(ctx, instanceId, templateId, {
      ensureWorkspace: false,
    });
    if (pluginsChanged) await restartGatewayForPlugins(ctx, instanceId);
    return result;
  },
});

/**
 * Pushes the Template's MCP servers, as the registry now resolves them, to an
 * active Agent's runtime config. Scheduled when a self-host MCP URL override
 * is set or cleared (#654): the running Agent otherwise keeps the old URL in
 * `openclaw.json` until it is reactivated. An inactive Agent is skipped — its
 * next activation merges the overridden URL anyway.
 */
export const pushMcpServers = internalAction({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, { instanceId, templateId }): Promise<void> => {
    const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
    if (agent?.status !== "active") return;
    const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);
    const { servers } = resolveMcpServers(template);
    await mergeRuntimeMcpServers(ctx, instanceId, template, servers, agent.config);
  },
});

export type ReconcileOutcome ={ templateId: string; status: RefreshResult["status"]; errorMessage?: string };

/**
 * Reconciles the Instance with the Project's registry (#652, ADR-054): every
 * active Agent (or just `templateId`'s) gets its workspace files, declared
 * skills and OpenClaw plugins re-pushed from the installed Template; the
 * Gateway restarts once at the end when a plugin changed (#661). Run after an installation and
 * when a (re)provisioned Instance links up. A failure on one Agent does not
 * stop the others; each outcome is reported.
 */
export const reconcileInstanceAgents = internalAction({
  args: { instanceId: v.string(), templateId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ReconcileOutcome[]> => {
    const active = await ctx.runQuery(listActiveByInstanceQuery, { instanceId: args.instanceId });
    const outcomes: ReconcileOutcome[] = [];
    let pluginsChanged = false;
    for (const agent of active) {
      if (args.templateId !== undefined && agent.templateId !== args.templateId) continue;
      const result = await refreshFromRegistry(ctx, args.instanceId, agent.templateId, { ensureWorkspace: true });
      pluginsChanged ||= result.pluginsChanged === true;
      outcomes.push({
        templateId: agent.templateId,
        status: result.status,
        ...(result.status === "error" ? { errorMessage: result.errorMessage } : {}),
      });
    }
    // Once, after every Agent is reconciled: the Instance is unreachable while the Gateway restarts.
    if (pluginsChanged) await restartGatewayForPlugins(ctx, args.instanceId);
    return outcomes;
  },
});

type AddAgentSkillResult =
  | { status: "installed"; skill: ProjectAgentSkill }
  | { status: "already_required"; skill: ProjectAgentSkill }
  | { status: "error"; errorMessage: string };

/**
 * Install an additional, user-chosen ClawHub Agent Skill into an active
 * Agent's workspace (issue #224). Generic across every active Agent — not
 * limited to any one Template. Reuses the same workspace-scoped
 * `clawhub install <spec> --workdir <path>` command and `skills[]` mirror
 * introduced for required Template skills (issue #222), but persists the
 * entry with `origin: "user"`.
 *
 * Product rules encoded here:
 * - A skill already present with `origin: "template"` is reported as
 *   already required/installed — no duplicate `origin: "user"` entry, and no
 *   OpenClaw call (it is already installed by the Template reconciliation).
 * - A skill already present with `origin: "user"` is re-installed to
 *   reconcile the workspace, then replaces (not duplicates) that entry.
 * - A failed install never changes the Agent's `status` — it stays `active`;
 *   only the per-skill mirror entry records `status: "error"`.
 */
export const addAgentSkill = action({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    spec: v.string(),
  },
  handler: async (ctx, args): Promise<AddAgentSkillResult> => {
    const { instanceId, templateId } = args;

    const user = await requireAuthenticatedUser(ctx);
    const ownership = await requireInstanceOwner(ctx, instanceId, user);
    if (!ownership.ok) {
      return { status: "error", errorMessage: ownership.errorMessage };
    }

    // Trim only — never lowercased or otherwise normalized (product decision).
    const spec = args.spec.trim();
    if (spec.length === 0) {
      return { status: "error", errorMessage: "Skill name is required" };
    }

    const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
    if (!agent) {
      return { status: "error", errorMessage: "Agent not found" };
    }
    if (agent.status !== "active") {
      return { status: "error", errorMessage: "Agent must be active to add a skill" };
    }
    if (!agent.workspaceKey) {
      return { status: "error", errorMessage: "Agent workspace not found" };
    }

    // A skill is unique per Agent by source + spec (product decision, issue
    // #224) — an existing entry for this spec, whatever its origin, is
    // looked up via the same key format `reconcileTemplateSkillsMirror` uses.
    const existingSkills = agent.skills ?? [];
    const existingEntry = findSkillByKey(existingSkills, "clawhub", spec);
    if (existingEntry?.origin === "template") {
      return { status: "already_required", skill: existingEntry };
    }

    const workspaceAbsolutePath = await resolveWorkspaceAbsolutePath(ctx, instanceId, agent.workspaceKey);
    const outcome = await installClawhubSkill(ctx, instanceId, workspaceAbsolutePath, spec);

    const skill: ProjectAgentSkill = {
      source: "clawhub",
      spec,
      origin: "user",
      status: outcome.status,
      updatedAt: Date.now(),
      errorMessage: outcome.errorMessage,
    };

    // Merge just this one entry via a mutation that re-reads `skills[]`
    // inside its own transaction, rather than writing the whole array
    // computed from the pre-install `existingSkills` snapshot above — a
    // concurrent refresh/reconcile that completed during the install await
    // would otherwise be clobbered (see `upsertAgentSkill` in
    // project_agents.ts).
    const upsertResult = await ctx.runMutation(upsertAgentSkillMutation, {
      instanceId,
      templateId,
      skill,
    });
    if (upsertResult.status === "not_found") {
      return { status: "error", errorMessage: "Agent not found" };
    }

    if (outcome.status === "error") {
      return { status: "error", errorMessage: skill.errorMessage ?? `Failed to install skill "${spec}"` };
    }
    return { status: "installed", skill };
  },
});

function isMissingRequiredUserConfigValue(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

type ReconfigureResult =
  | { status: "updated" }
  | { status: "error"; errorMessage: string };

export const reconfigureProjectAgent = action({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    userConfig: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args): Promise<ReconfigureResult> => {
    const { instanceId, templateId, userConfig } = args;

    const user = await requireAuthenticatedUser(ctx);
    const ownership = await requireInstanceOwner(ctx, instanceId, user);
    if (!ownership.ok) {
      return { status: "error", errorMessage: ownership.errorMessage };
    }

    try {
      const template = await getTemplateRegistry(ctx).resolve(instanceId, templateId);
      if (!template) {
        return { status: "error", errorMessage: `Template not found: ${templateId}` };
      }
      const reconfigurationEffect = template.manifest.reconfiguration;
      const isConfigOnly = template.manifest.reconfigurable === true;
      if (!reconfigurationEffect && !isConfigOnly) {
        return { status: "error", errorMessage: `Template ${templateId} is not reconfigurable` };
      }

      const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
      if (!agent) {
        return { status: "error", errorMessage: "Agent not found" };
      }
      if (agent.status !== "active") {
        return { status: "error", errorMessage: "Agent must be active to reconfigure" };
      }
      const currentConfig = agent.config ?? {};

      let config: Record<string, unknown>;

      if (isConfigOnly && !reconfigurationEffect) {
        // No external MCP server — just merge the new user config into the stored config.
        const { apiKey: _ignoredApiKey, ...mutableUserConfig } = userConfig;
        config = { ...currentConfig, ...mutableUserConfig };
      } else {
        const { activationUrls } = resolveMcpServers(template);
        const serverName = reconfigurationEffect!.server;
        const serverUrl = activationUrls[serverName];
        if (!serverUrl) {
          throw new Error(`Cannot reconfigure ${templateId}: no URL found for MCP server ${serverName}`);
        }

        // apiKey is immutable: always read from the frozen existing config.
        // Strip it from userConfig so the engine cannot overwrite the frozen value.
        const apiKey = String(currentConfig.apiKey ?? "");
        const { apiKey: _ignoredApiKey, ...mutableUserConfig } = userConfig;
        const origin = new URL(serverUrl).origin;

        ({ config } = await executeActivationEffect(
          reconfigurationEffect!,
          mutableUserConfig,
          currentConfig,
          origin,
          apiKey,
        ));
      }

      // Push the (possibly changed) delivered requirement before persisting,
      // so a failed delivery leaves the stored config matching the Instance.
      await deliverRequirementToInstance(ctx, instanceId, templateId, template.manifest, config);

      await ctx.runMutation(upsertProjectAgentMutation, {
        instanceId,
        templateId,
        status: "active",
        config,
      });

      return { status: "updated" };
    } catch (error) {
      return {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

type DeactivationResult =
  | { status: "inactive" }
  | { status: "error"; errorMessage: string };

export const deactivateProjectAgent = action({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
  },
  handler: async (ctx, args): Promise<DeactivationResult> => {
    const { instanceId, templateId } = args;

    const user = await requireAuthenticatedUser(ctx);
    const ownership = await requireInstanceOwner(ctx, instanceId, user);
    if (!ownership.ok) {
      return { status: "error", errorMessage: ownership.errorMessage };
    }

    // Known race: the count is read outside a transaction; a new run may be created
    // after this check and before the agent is set inactive below. Acceptable until
    // a transactional deactivation mechanism is introduced (same window as MCP key removal).
    const activeRunCount = await ctx.runQuery(countActiveRunsByInstanceTemplateQuery, { instanceId, templateId });
    if (activeRunCount > 0) {
      return { status: "error", errorMessage: `Cannot deactivate: ${activeRunCount} run(s) still active` };
    }

    const agent = await ctx.runQuery(getByInstanceAndTemplateQuery, { instanceId, templateId });
    if (!agent) {
      return { status: "error", errorMessage: "Agent not found" };
    }
    if (agent.status === "inactive") {
      return { status: "inactive" };
    }

    // Known race: if another agent is activated between this read and the remove
    // below, we may wrongly remove a key that the new agent also references.
    // The same window exists in activateProjectAgent; acceptable until a
    // transactional deactivation mechanism is introduced.
    const allActive = await ctx.runQuery(listActiveByInstanceQuery, { instanceId });

    const refCounts = new Map<string, number>();
    for (const a of allActive) {
      for (const key of a.mcpServerKeys) {
        refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
      }
    }

    const keysToRemove = agent.mcpServerKeys.filter((key) => refCounts.get(key) === 1);

    if (keysToRemove.length > 0) {
      const removeResult = await sendAndAwait(ctx, instanceId, RUNTIME_MCP_SERVERS_REMOVE, {
        keys: keysToRemove,
      });
      const removePayload = removeResult.payload as RuntimeMcpServersRemoveResultPayload | undefined;
      if (!removeResult.found || !removePayload?.ok) {
        const errorMessage = removePayload?.error ?? "MCP remove failed";
        return { status: "error", errorMessage };
      }
    }

    await deleteNativeOpenClawAgent(ctx, instanceId, agent.openclawAgentName ?? openClawAgentSlug(templateId));

    const deactivateResult = await ctx.runMutation(markInactiveIfNoActiveRunsMutation, { instanceId, templateId });
    if (!deactivateResult.ok) {
      return { status: "error", errorMessage: `Cannot deactivate: ${deactivateResult.count} run(s) still active` };
    }

    return { status: "inactive" };
  },
});
