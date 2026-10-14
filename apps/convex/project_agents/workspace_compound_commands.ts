"use node";

import type { ActionCtx } from "../_generated/server.js";
import { openClawAgentSlug } from "@opengroow/agent-templates";
import type { OpenClawProfile } from "@opengroow/agent-templates/types";
import {
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_SKILLS_INSTALL_BATCH,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
  parseOpenClawAgents,
  type OpenClawAgentSummary,
} from "@opengroow/protocol";
import type { RuntimeResultQueryResult } from "../runtime_commands_node.js";
import {
  COMPOUND_STEP_TIMEOUT_MS,
  compoundWaitMs,
  isCompoundUnsupported,
  parseOpenClawExecResult,
  sendAndAwait,
  shellQuote,
} from "./runtime_calls.js";

export const OPENCLAW_DEFAULT_FILES = [
  "SOUL.md", "USER.md", "IDENTITY.md", "HEARTBEAT.md",
  "BOOT.md", "BOOTSTRAP.md", "MEMORY.md",
];

/**
 * Deletes files from an Agent's workspace: one batch command, falling back to
 * one command per file when the runtime does not support batches. Deleting an
 * already-absent file is a no-op, and failures are only logged, never thrown.
 */
export async function deleteWorkspaceFiles(
  ctx: ActionCtx,
  instanceId: string,
  workspaceKey: string,
  filePaths: readonly string[],
): Promise<void> {
  let batchResult: Awaited<ReturnType<typeof sendAndAwait>> | null = null;
  try {
    batchResult = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_FILE_DELETE_BATCH, {
      workspaceKey,
      filePaths: [...filePaths],
    });
  } catch (error) {
    console.warn(
      `[project_agents/workspace_provisioning] Batch delete failed before returning a result: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  const batchPayload = batchResult?.payload as {
    ok?: boolean;
    data?: { results?: Array<{ filePath: string; ok: boolean; error?: string }> };
  } | undefined;

  if (batchResult === null || isCompoundUnsupported(batchResult) || !batchResult.found) {
    const fallbackResults = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const result = await sendAndAwait(ctx, instanceId, RUNTIME_WORKSPACE_FILE_DELETE, {
            workspaceKey,
            filePath,
          });
          return { filePath, result };
        } catch (error) {
          return { filePath, error: error instanceof Error ? error.message : "unknown error" };
        }
      }),
    );
    for (const fallback of fallbackResults) {
      const payload = fallback.result?.payload as { ok?: boolean; error?: string } | undefined;
      if (!fallback.result?.found || !payload?.ok) {
        console.warn(
          `[project_agents/workspace_provisioning] Could not delete ${fallback.filePath}: ${
            fallback.error ?? payload?.error ?? "not found or timeout"
          }`,
        );
      }
    }
    return;
  }

  if (!batchPayload?.ok) {
    const failedFiles = batchPayload?.data?.results?.filter((result) => !result.ok) ?? [];
    console.warn(
      `[project_agents/workspace_provisioning] Batch delete: ${failedFiles.length} file(s) failed: ${
        failedFiles.map((file) => `${file.filePath}: ${file.error ?? "unknown"}`).join(", ")
      }`,
    );
  }
}

async function listNativeOpenClawAgents(
  ctx: ActionCtx,
  instanceId: string,
): Promise<OpenClawAgentSummary[]> {
  const result = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, {
    commandText: "openclaw agents list --json",
  });
  const payload = parseOpenClawExecResult(result, "OpenClaw agents list failed");
  try {
    return parseOpenClawAgents(payload.data.output);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `OpenClaw agents list returned invalid JSON: ${error.message}`
        : "OpenClaw agents list returned invalid JSON",
    );
  }
}

export async function registerNativeOpenClawAgent(
  ctx: ActionCtx,
  instanceId: string,
  templateId: string,
  workspaceAbsolutePath: string,
  profile: OpenClawProfile | undefined,
): Promise<void> {
  const agentId = openClawAgentSlug(templateId);
  const listCommandText = "openclaw agents list --json";
  const registerCommandText = `openclaw agents add ${shellQuote(agentId)} --workspace ${shellQuote(workspaceAbsolutePath)} --non-interactive --json`;
  const configureCommandText = openClawToolsConfigCommand(agentId, profile);
  const steps = configureCommandText ? 3 : 2;
  const result = await sendAndAwait(
    ctx,
    instanceId,
    RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
    {
      agentId,
      listCommandText,
      registerCommandText,
      configureCommandText,
      timeoutMs: COMPOUND_STEP_TIMEOUT_MS,
    },
    compoundWaitMs(steps),
  );

  if (isCompoundUnsupported(result)) {
    console.warn(
      `[project_agents/workspace_provisioning] ${RUNTIME_AGENT_REGISTER_AND_CONFIGURE} unsupported on ${instanceId}; falling back to individual commands`,
    );
    await registerNativeOpenClawAgentIndividually(
      ctx,
      instanceId,
      agentId,
      workspaceAbsolutePath,
      registerCommandText,
      configureCommandText,
    );
    return;
  }

  const data = parseAgentRegisterAndConfigureResult(result);
  if (data.alreadyRegistered) {
    warnOnWorkspaceMismatch(agentId, data.workspace, workspaceAbsolutePath);
    return;
  }
  if (configureCommandText && !data.configured) {
    console.warn(
      `[project_agents/workspace_provisioning] Could not apply the OpenClaw profile of ${templateId}: ${
        data.configureError ?? "Unknown error"
      }`,
    );
  }
}

async function registerNativeOpenClawAgentIndividually(
  ctx: ActionCtx,
  instanceId: string,
  agentId: string,
  workspaceAbsolutePath: string,
  registerCommandText: string,
  configureCommandText: string | undefined,
): Promise<void> {
  const agents = await listNativeOpenClawAgents(ctx, instanceId);
  const existing = agents.find((agent) => agent.id === agentId);
  if (existing) {
    warnOnWorkspaceMismatch(agentId, existing.workspace, workspaceAbsolutePath);
    return;
  }
  const addResult = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, {
    commandText: registerCommandText,
  });
  parseOpenClawExecResult(addResult, "OpenClaw agents add failed");
  if (configureCommandText) await applyAgentToolRestrictions(ctx, instanceId, agentId, configureCommandText);
}

function warnOnWorkspaceMismatch(
  agentId: string,
  registeredWorkspace: string | undefined,
  expectedWorkspace: string | undefined,
): void {
  if (registeredWorkspace && expectedWorkspace && registeredWorkspace !== expectedWorkspace) {
    console.warn(
      `[project_agents/workspace_provisioning] OpenClaw agent ${agentId} is already registered for ${registeredWorkspace}; expected ${expectedWorkspace}`,
    );
  }
}

function parseAgentRegisterAndConfigureResult(
  result: RuntimeResultQueryResult,
): { alreadyRegistered: boolean; workspace?: string; configured: boolean; configureError?: string } {
  const payload = result.payload as
    | {
        ok?: boolean;
        error?: string;
        data?: {
          alreadyRegistered?: boolean;
          workspace?: string;
          configured?: boolean;
          configureError?: string;
        };
      }
    | undefined;
  if (result.type !== RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT || !result.found || !payload?.ok) {
    throw new Error(payload?.error ?? "OpenClaw agents add failed");
  }
  return {
    alreadyRegistered: payload.data?.alreadyRegistered === true,
    workspace: payload.data?.workspace,
    configured: payload.data?.configured === true,
    configureError: payload.data?.configureError,
  };
}

/**
 * The `openclaw config set` command applying a Template's OpenClaw profile to
 * its Agent, or undefined when the profile restricts nothing (OpenClaw defaults).
 */
function openClawToolsConfigCommand(agentId: string, profile: OpenClawProfile | undefined): string | undefined {
  const toolsConfig = {
    ...(profile?.toolDeny && profile.toolDeny.length > 0 ? { deny: profile.toolDeny } : {}),
    ...(profile?.execNode ? { exec: { host: "node", node: profile.execNode } } : {}),
  };
  if (Object.keys(toolsConfig).length === 0) return undefined;
  return `openclaw config set ${shellQuote(`agents.entries.${agentId}.tools`)} ${shellQuote(JSON.stringify(toolsConfig))} --json --merge`;
}

async function applyAgentToolRestrictions(
  ctx: ActionCtx,
  instanceId: string,
  agentId: string,
  configureCommandText: string,
): Promise<void> {
  const result = await sendAndAwait(ctx, instanceId, RUNTIME_OPENCLAW_EXEC, { commandText: configureCommandText });
  try {
    parseOpenClawExecResult(result, `Failed to apply the OpenClaw profile of agent ${agentId}`);
  } catch (error) {
    console.warn(
      `[project_agents/workspace_provisioning] Could not apply the OpenClaw profile of ${agentId}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

export async function installClawhubSkillsBatch(
  ctx: ActionCtx,
  instanceId: string,
  workspaceAbsolutePath: string,
  required: Array<{ spec: string }>,
): Promise<Array<{ ok: boolean; error?: string }> | null> {
  let result: RuntimeResultQueryResult;
  try {
    result = await sendAndAwait(
      ctx,
      instanceId,
      RUNTIME_SKILLS_INSTALL_BATCH,
      {
        specs: required.map((skill) => skill.spec),
        commandTexts: required.map(
          (skill) => `clawhub install ${shellQuote(skill.spec)} --workdir ${shellQuote(workspaceAbsolutePath)}`,
        ),
        timeoutMs: COMPOUND_STEP_TIMEOUT_MS,
      },
      compoundWaitMs(required.length),
    );
  } catch (error) {
    console.warn(
      `[project_agents/workspace_provisioning] ${RUNTIME_SKILLS_INSTALL_BATCH} failed before returning a result on ${instanceId}: ${
        error instanceof Error ? error.message : "unknown error"
      }; falling back to individual installs`,
    );
    return null;
  }
  if (isCompoundUnsupported(result)) {
    console.warn(
      `[project_agents/workspace_provisioning] ${RUNTIME_SKILLS_INSTALL_BATCH} unsupported on ${instanceId}; falling back to individual installs`,
    );
    return null;
  }
  const payload = result.payload as
    | { ok?: boolean; error?: string; data?: { results?: Array<{ ok?: boolean; error?: string }> } }
    | undefined;
  if (result.type !== RUNTIME_SKILLS_INSTALL_BATCH_RESULT || !result.found) {
    throw new Error(payload?.error ?? "Skill install batch failed");
  }
  const results = payload?.data?.results;
  if (!Array.isArray(results) || results.length !== required.length) {
    throw new Error(payload?.error ?? "Skill install batch returned an unexpected result shape");
  }
  return results.map((entry) => ({ ok: entry.ok === true, error: entry.error }));
}
