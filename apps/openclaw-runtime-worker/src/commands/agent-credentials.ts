import { RUNTIME_AGENT_CREDENTIAL_SET_RESULT } from "@opengroow/protocol";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

function readString(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export const handleAgentCredentialSet: CommandHandler = async (command, deps) => {
  const payload = command.payload as Record<string, unknown> | undefined;
  const agentId = readString(payload, "agentId");
  const apiKey = readString(payload, "apiKey");
  const result = (ok: boolean, error?: string) =>
    createEventMessage(RUNTIME_AGENT_CREDENTIAL_SET_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok,
      error,
      data: { agentId },
    });

  // Any Agent whose Template marks a requirement `deliveredToInstance` uses
  // this channel; the value is stored under its own OpenClaw agent id.
  if (!agentId) {
    return result(false, "agentId is required");
  }
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "apiKey") || typeof payload.apiKey !== "string") {
    return result(false, "apiKey is required");
  }

  try {
    await deps.writeAgentCredential(agentId, apiKey);
    return result(true);
  } catch {
    return result(false, "Agent credential storage failed");
  }
};
