"use node";

import type { ActionCtx } from "../_generated/server.js";
import { collectTemplateWorkspaceFiles, hiddenMissionInstructionPaths } from "./template_workspace_files.js";
import type { Id } from "../_generated/dataModel.js";
import type { FunctionReference } from "convex/server";
import {
  deliveredRequirementField,
  getRequiredTemplateSkills,
  openClawAgentSlug,
  reconcileTemplateSkillsMirror,
  type AgentTemplate,
  type AgentManifest,
  type ProjectAgentSkill,
  type SkillInstallOutcome,
} from "@opengroow/agent-templates";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_AGENT_CREDENTIAL_SET,
  RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_FILE_WRITE,
  type RuntimeWorkspaceListResultPayload,
  type RuntimeWorkspaceFileWriteResultPayload,
} from "@opengroow/protocol";
import {
  sendAndAwait,
  parseOpenClawExecResult,
  shellQuote,
} from "./runtime_calls.js";
import { installTemplatePlugins } from "./template_plugins.js";

/**
 * Push the value of the requirement the Template marked `deliveredToInstance`
 * to the Instance (its credential channel). OpenGroow does not know which
 * Template declared it. No marked requirement means nothing to deliver; an
 * empty value is still sent, which clears the previously delivered one.
 * Sent over `runtime.agent-credential.set` (`apiKey`); the Instance stores the
 * value per OpenClaw agent id.
 */
export async function deliverRequirementToInstance(
  ctx: ActionCtx,
  instanceId: string,
  templateId: string,
  manifest: AgentManifest,
  config: Record<string, unknown> | undefined,
): Promise<void> {
  const field = deliveredRequirementField(manifest);
  if (!field) return;

  const value = config?.[field.key];
  const result = await sendAndAwait(ctx, instanceId, RUNTIME_AGENT_CREDENTIAL_SET, {
    agentId: openClawAgentSlug(templateId),
    apiKey: typeof value === "string" ? value.trim() : "",
  });
  const payload = result.payload as { ok?: boolean; error?: string } | undefined;
  if (
    result.type !== RUNTIME_AGENT_CREDENTIAL_SET_RESULT ||
    !result.found ||
    !payload?.ok
  ) {
    throw new Error(payload?.error ?? `Delivery of "${field.key}" to the Project's runtime failed`);
  }
}
import {
  OPENCLAW_DEFAULT_FILES,
  deleteWorkspaceFiles,
  installClawhubSkillsBatch,
  registerNativeOpenClawAgent,
} from "./workspace_compound_commands.js";

type UpsertProjectAgentMutation = FunctionReference<
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
    config?: Record<string, unknown>;
    skills?: ProjectAgentSkill[];
  },
  Id<"projectAgents">
>;

export async function resolveWorkspaceAbsolutePath(
  ctx: ActionCtx,
  instanceId: string,
  workspaceKey: string,
): Promise<string> {
  const listResult = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_LIST, {});
  const listPayload = listResult.payload as RuntimeWorkspaceListResultPayload | undefined;
  if (!listResult.found || !listPayload?.ok) {
    throw new Error(listPayload?.error ?? "Workspace list failed");
  }
  const descriptor = listPayload.data.workspaces.find(
    (workspace) => workspace.workspaceKey === workspaceKey,
  );
  if (!descriptor?.absolutePath) {
    throw new Error(`Workspace absolutePath not found for ${workspaceKey}`);
  }
  return descriptor.absolutePath;
}

export async function deleteNativeOpenClawAgent(
  ctx: ActionCtx,
  instanceId: string,
  openclawAgentName: string,
): Promise<void> {
  const result = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, {
    commandText: `openclaw agents delete ${shellQuote(openclawAgentName)}`,
  });
  try {
    parseOpenClawExecResult(result, "OpenClaw agents delete failed");
  } catch (error) {
    console.warn(
      `[project_agents/workspace_provisioning] OpenClaw agent delete failed for ${openclawAgentName}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

async function writeTemplateWorkspaceFiles(
  ctx: ActionCtx,
  instanceId: string,
  workspaceKey: string,
  files: Map<string, string>,
): Promise<void> {
  for (const [filePath, content] of files) {
    const writeResult = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_FILE_WRITE, {
      workspaceKey,
      filePath,
      content,
    });
    const writePayload = writeResult.payload as RuntimeWorkspaceFileWriteResultPayload | undefined;
    if (!writeResult.found || !writePayload?.ok) {
      throw new Error(writePayload?.error ?? `File write failed: ${filePath}`);
    }
  }
}

/**
 * Install one OpenClaw Agent Skill into the Agent's workspace via the
 * genuine, workspace-scoped ClawHub CLI command (`clawhub install <spec>
 * --workdir <absolute-workspace-path>`). `clawhub` is a separate binary from
 * `openclaw` — see `apps/openclaw-docker-config/docker/entrypoint.sh`, which
 * uses this exact command to seed skills from the manifest at container
 * boot. Shared by required Template skills (issue #222, `origin: "template"`)
 * and user-added skills (issue #224, `origin: "user"`): a failed install is
 * reported as an "error" outcome rather than thrown, so callers can persist a
 * useful per-skill errorMessage on the skills mirror.
 */
export async function installClawhubSkill(
  ctx: ActionCtx,
  instanceId: string,
  workspaceAbsolutePath: string,
  spec: string,
): Promise<{ status: "installed" | "error"; errorMessage?: string }> {
  try {
    const result = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, {
      commandText: `clawhub install ${shellQuote(spec)} --workdir ${shellQuote(workspaceAbsolutePath)}`,
    });
    parseOpenClawExecResult(result, `Failed to install skill "${spec}"`);
    return { status: "installed" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // ClawHub refuses to reinstall an already-present skill directory
    // without `--force` (same idempotency case entrypoint.sh handles at
    // container boot by skipping already-installed dirs, see
    // apps/openclaw-docker-config/docker/entrypoint.sh). Reconciliation
    // just needs the skill present, so this is a success, not a failure.
    if (/already installed/i.test(errorMessage)) {
      return { status: "installed" };
    }
    return { status: "error", errorMessage };
  }
}

/**
 * Reconcile the Template's currently required skills against the Agent's
 * workspace and persisted mirror (issue #222). Installs every required skill
 * (one at a time), then folds the outcomes into the persisted `skills[]`
 * mirror via `reconcileTemplateSkillsMirror` — replacing existing entries for
 * the same source+spec and dropping stale `origin: "template"` entries the
 * Template no longer declares.
 */
async function reconcileTemplateSkills(
  ctx: ActionCtx,
  instanceId: string,
  workspaceAbsolutePath: string,
  manifest: AgentManifest,
  existingSkills: ProjectAgentSkill[],
): Promise<{ skills: ProjectAgentSkill[]; failed: SkillInstallOutcome[] }> {
  const required = getRequiredTemplateSkills(manifest);
  const outcomes: SkillInstallOutcome[] = [];

  // A single compound command rather than a batch: ClawHub installs are not
  // parallel-safe (issue #447) and the Runtime Worker starts the handlers of
  // a batch concurrently, so the sequencing has to happen inside the worker.
  // Below two skills there is nothing to sequence, so the individual command
  // is both simpler and always supported.
  const installResults = required.length > 1
    ? await installClawhubSkillsBatch(ctx, instanceId, workspaceAbsolutePath, required)
    : null;

  if (installResults) {
    for (let i = 0; i < required.length; i++) {
      const installed = installResults[i];
      // ClawHub refuses to reinstall an already-present skill directory
      // without `--force`; reconciliation just needs the skill present.
      if (installed.ok || /already installed/i.test(installed.error ?? "")) {
        outcomes.push({ source: required[i].source, spec: required[i].spec, status: "installed" });
      } else {
        outcomes.push({
          source: required[i].source,
          spec: required[i].spec,
          status: "error",
          errorMessage: installed.error ?? `Failed to install skill "${required[i].spec}"`,
        });
      }
    }
  } else {
    // Either a single skill, or the compound command is not supported by this
    // Instance yet: install them one at a time, which is what the pre-compound
    // code did and what issue #447 requires to stay available during rollout.
    for (const skill of required) {
      const outcome = await installClawhubSkill(ctx, instanceId, workspaceAbsolutePath, skill.spec);
      outcomes.push({ source: skill.source, spec: skill.spec, ...outcome });
    }
  }

  const failed = outcomes.filter((outcome) => outcome.status === "error");
  const skills = reconcileTemplateSkillsMirror(existingSkills, required, outcomes, Date.now());
  return { skills, failed };
}

export type WorkspaceContentResult =
  | {
      status: "ok";
      skills: ProjectAgentSkill[];
      /** Plugins installed or changed on the Instance: the Gateway must restart for them to load. */
      pluginsChanged: boolean;
    }
  | { status: "error"; errorMessage: string };

/**
 * Provision an Agent's OpenClaw workspace content: register the native
 * OpenClaw agent, optionally clear OpenClaw's default files, seed the
 * Template's own workspace files, and reconcile required skills.
 * `activateProjectAgent` and `refreshProjectAgent` are two
 * different callers of this exact same sequence — before this step existed,
 * each duplicated it under its own framing (activation vs refresh).
 */
export async function provisionWorkspaceContent(
  ctx: ActionCtx,
  args: {
    instanceId: string;
    templateId: string;
    workspaceKey: string;
    knownWorkspaceAbsolutePath: string | undefined;
    template: Pick<AgentTemplate, "agentsMd" | "manifest" | "missionAgentsMd" | "sourceInstructions" | "jobInstructions" | "plugins">;
    agentConfig?: Record<string, unknown>;
    /** Mission types the operator hides from this Agent (ADR-053): no instruction file for them. */
    hiddenMissionTypes?: readonly string[];
    existingSkills: ProjectAgentSkill[];
    clearOpenClawDefaults: boolean;
    upsertMutation: UpsertProjectAgentMutation;
  },
): Promise<WorkspaceContentResult> {
  const { instanceId, templateId, workspaceKey, template, existingSkills, clearOpenClawDefaults } = args;

  // Collected (and the manifest re-validated) BEFORE anything is mutated on the
  // instance: a broken Source or Mission declaration must fail without having
  // already registered the OpenClaw agent or deleted its default files, which
  // would leave the workspace with neither OpenClaw's defaults nor an AGENTS.md.
  const templateFiles = collectTemplateWorkspaceFiles(template, { hiddenMissionTypes: args.hiddenMissionTypes });

  // Resolved once, up front, and reused by both the agent registration and
  // `clawhub install --workdir`: the register/configure compound command
  // needs it to build its `agents add` step, so it can no longer be looked up
  // lazily only when the agent turns out to be missing.
  const workspaceAbsolutePath =
    args.knownWorkspaceAbsolutePath ??
    (await resolveWorkspaceAbsolutePath(ctx, instanceId, workspaceKey));

  await registerNativeOpenClawAgent(ctx, instanceId, templateId, workspaceAbsolutePath, template.manifest.openclawProfile);
  await deliverRequirementToInstance(ctx, instanceId, templateId, template.manifest, args.agentConfig);

  // One batch for both: OpenClaw's re-seeded default files and the instruction
  // files of Mission types the Agent hides (a workspace written before the type
  // was hidden still carries them — writing never removes, ADR-053).
  const filesToDelete = [
    ...(clearOpenClawDefaults ? OPENCLAW_DEFAULT_FILES : []),
    ...hiddenMissionInstructionPaths(template, args.hiddenMissionTypes),
  ];
  if (filesToDelete.length > 0) {
    await deleteWorkspaceFiles(ctx, instanceId, workspaceKey, filesToDelete);
  }

  await writeTemplateWorkspaceFiles(ctx, instanceId, workspaceKey, templateFiles);

  const { skills, failed } = await reconcileTemplateSkills(
    ctx,
    instanceId,
    workspaceAbsolutePath,
    template.manifest,
    existingSkills,
  );
  if (failed.length > 0) {
    const errorMessage = `Failed to install required Template skill(s): ${failed
      .map((f) => `${f.spec}${f.errorMessage ? ` (${f.errorMessage})` : ""}`)
      .join(", ")}`;
    await ctx.runMutation(args.upsertMutation, { instanceId, templateId, status: "error", errorMessage, skills });
    return { status: "error", errorMessage };
  }

  let pluginsChanged = false;
  if (template.plugins && template.plugins.length > 0) {
    try {
      pluginsChanged = (await installTemplatePlugins(ctx, instanceId, template.plugins)).length > 0;
    } catch (error) {
      const errorMessage = `Failed to install Template plugin(s): ${error instanceof Error ? error.message : String(error)}`;
      await ctx.runMutation(args.upsertMutation, { instanceId, templateId, status: "error", errorMessage, skills });
      return { status: "error", errorMessage };
    }
  }

  return { status: "ok", skills, pluginsChanged };
}
