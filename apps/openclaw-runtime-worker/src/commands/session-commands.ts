import { RUNTIME_SESSION_TRANSCRIPT_READ_RESULT } from "@opengroow/protocol";
import { readAgentName, readSessionKey } from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

export const handleSessionTranscriptRead: CommandHandler = async (
  command,
  deps,
) => {
  const agentName = readAgentName(command.payload);
  const sessionKey = readSessionKey(command.payload);

  if (!agentName || !sessionKey) {
    return createEventMessage(RUNTIME_SESSION_TRANSCRIPT_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "agentName and sessionKey are required",
      data: { agentName, found: false, turns: [] },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      agentName: string;
      found: boolean;
      turns: Array<{ role: string; text: string; timestamp?: string }>;
    }>("/session/transcript", { agentName, sessionKey });

    return createEventMessage(RUNTIME_SESSION_TRANSCRIPT_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: {
        agentName: result.agentName,
        found: result.found,
        turns: result.turns,
      },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_SESSION_TRANSCRIPT_READ_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read session transcript",
      data: { agentName, found: false, turns: [] },
    });
  }
};
