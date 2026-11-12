import {
  MCP_SERVER_UNREACHABLE,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
  RUNTIME_TELEGRAM_CONFIG_SET_RESULT,
} from "@opengroow/protocol";
import {
  readAuthSessionId,
  readCommandText,
  readFilesToWrite,
  readRequiredMcpServers,
  readTimeoutMs,
  readWorkspaceKey,
} from "./command-inputs.js";
import { makeGatewayCommandHandler } from "./auth-commands.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler, RuntimeDeps } from "./types.js";

export const handleTelegramConfigSet: CommandHandler = async (
  command,
  deps,
) => {
  const payload = command.payload as
    | { botToken?: string; dmPolicy?: string }
    | undefined;
  const botToken =
    typeof payload?.botToken === "string" ? payload.botToken.trim() : "";
  const dmPolicy =
    typeof payload?.dmPolicy === "string" ? payload.dmPolicy.trim() : "open";
  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
    }>("/telegram/config", {
      botToken,
      dmPolicy,
    });
    return createEventMessage(RUNTIME_TELEGRAM_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: { output: result.output },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_TELEGRAM_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "Telegram config failed",
      data: { output: "" },
    });
  }
};

export const handleAiConfigSet: CommandHandler = async (command, deps) => {
  const payload = command.payload as
    | { provider?: string; apiKey?: string; model?: string; baseUrl?: string }
    | undefined;
  const provider =
    typeof payload?.provider === "string" ? payload.provider.trim() : "";
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const model = typeof payload?.model === "string" ? payload.model.trim() : "";
  const baseUrl =
    typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
  try {
    const body: Record<string, string> = { provider, apiKey, model };
    if (baseUrl) body.baseUrl = baseUrl;
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      provider?: string;
      model?: string;
    }>("/ai/config", body);
    return createEventMessage(RUNTIME_AI_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        output: result.output,
        provider: result.provider,
        model: result.model,
        baseUrl: baseUrl || undefined,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_AI_CONFIG_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "AI config failed",
      data: { output: "" },
    });
  }
};

export const handleSpeechToTextConfigSet: CommandHandler = async (
  command,
  deps,
) => {
  const payload = command.payload as
    | { provider?: string; enabled?: boolean; apiKey?: string }
    | undefined;
  const provider =
    typeof payload?.provider === "string" ? payload.provider.trim() : "";
  const enabled = payload?.enabled === true;
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      provider?: string;
      enabled?: boolean;
    }>("/speech-to-text/config", {
      provider,
      enabled,
      apiKey,
    });
    return createEventMessage(
      RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
      command.id,
      {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: true,
        data: {
          output: result.output,
          provider: result.provider,
          enabled: result.enabled,
        },
      },
    );
  } catch (error) {
    return createEventMessage(
      RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
      command.id,
      {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error:
          error instanceof Error ? error.message : "Speech-to-text config failed",
        data: { output: "", provider, enabled },
      },
    );
  }
};

/**
 * Connects to the MCP servers an Agent session needs before starting it.
 * OpenClaw starts a session even when one of them fails to connect, and the
 * Agent then only notices a tool is missing after doing the rest of its work.
 * Returns the failure message, or `null` when every server answered. A probe
 * that cannot run at all (a Gateway image without the route) does not block
 * the session: it behaves as before the probe existed.
 */
async function probeRequiredMcpServers(keys: string[], deps: RuntimeDeps): Promise<string | null> {
  if (keys.length === 0) return null;
  let results: Array<{ key: string; ok: boolean; error?: string }>;
  try {
    ({ results } = await deps.gatewayClient.requestGatewayControl<{
      results: Array<{ key: string; ok: boolean; error?: string }>;
    }>("/mcp/servers/probe", { keys }));
  } catch (error) {
    deps.warn(`MCP probe skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return null;
  const reasons = failed.map((result) => `${result.key} (${result.error ?? "failed to start"})`).join("; ");
  return `MCP server unreachable from OpenClaw: ${reasons}`;
}

export const handleOpenClawExec: CommandHandler = async (command, deps) => {
  const commandText = readCommandText(command.payload);
  const timeoutMs = readTimeoutMs(command.payload, 30_000);

  if (!commandText) {
    return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "OpenClaw command is required",
      data: {
        output: "",
        commandText,
        exitCode: null,
      },
    });
  }

  // Files carried by the exec itself, written in order right before the
  // agent starts. They are not separate commands on purpose: the router
  // starts every command handler without awaiting the previous one, so
  // sibling write commands would race this exec and the agent could boot on
  // stale instructions (mission_dispatcher_node.ts explains the case).
  const filesToWrite = readFilesToWrite(command.payload);
  const workspaceKey = readWorkspaceKey(command.payload);
  if (filesToWrite === null) {
    return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "filesToWrite must contain only filePath/content string pairs",
      data: { output: "", commandText, exitCode: null },
    });
  }

  const unreachable = await probeRequiredMcpServers(readRequiredMcpServers(command.payload), deps);
  if (unreachable) {
    return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      errorCode: MCP_SERVER_UNREACHABLE,
      error: unreachable,
      data: { output: "", commandText, exitCode: null },
    });
  }

  if (filesToWrite.length > 0) {
    if (!workspaceKey) {
      return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error: "workspaceKey is required when filesToWrite is provided",
        data: { output: "", commandText, exitCode: null },
      });
    }
    for (const file of filesToWrite) {
      try {
        await deps.gatewayClient.requestGatewayControl<{ workspaceKey: string; filePath: string }>(
          "/workspace/file/write",
          { workspaceKey, filePath: file.filePath, content: file.content },
        );
      } catch (error) {
        return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
          commandId: command.id,
          instanceId: deps.getRuntimeInstanceId(),
          ok: false,
          error: `Failed to write ${file.filePath} before exec: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
          data: { output: "", commandText, exitCode: null },
        });
      }
    }
  }

  try {
    deps.log(`openclaw exec: ${commandText}`);
    const result = await deps.gatewayClient.requestGatewayControl<{
      output: string;
      success?: boolean;
      exitCode?: number | null;
      error?: string;
    }>("/openclaw/exec", {
      commandText,
      timeoutMs,
    });
    return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: result.success !== false,
      error:
        result.success === false
          ? result.error || "OpenClaw command failed"
          : undefined,
      data: {
        output: result.output || "",
        commandText,
        exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_OPENCLAW_EXEC_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: error instanceof Error ? error.message : "OpenClaw command failed",
      data: {
        output: "",
        commandText,
        exitCode: null,
      },
    });
  }
};

// Relays sessionId to the gateway's cancel route. Reuses the same
// validate/relay/wrap-into-a-result-event shape as the auth command family
// (makeGatewayCommandHandler, auth-commands.ts) rather than re-deriving it
// by hand — this is the second caller outside "auth" that needed that exact
// shape, which is why the factory is named generically.
export const handleOpenClawExecCancel: CommandHandler = makeGatewayCommandHandler(
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
  "/openclaw/exec/cancel",
  (payload) => {
    const sessionId = readAuthSessionId(payload);
    return {
      body: { sessionId },
      failData: { cancelled: false },
      validationError: sessionId ? undefined : "sessionId is required",
    };
  },
  "OpenClaw exec cancel failed",
);
