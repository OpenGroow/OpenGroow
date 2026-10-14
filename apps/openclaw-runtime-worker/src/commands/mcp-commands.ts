import {
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
} from "@opengroow/protocol";
import { readMcpServerKeys, readMcpServers } from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

export const handleMcpServersMerge: CommandHandler = async (command, deps) => {
  const servers = readMcpServers(command.payload);

  if (!servers) {
    return createEventMessage(RUNTIME_MCP_SERVERS_MERGE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "servers is required and must be a non-empty object",
      data: { mergedKeys: [] },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      mergedKeys: string[];
    }>("/mcp/servers/merge", { servers });

    return createEventMessage(RUNTIME_MCP_SERVERS_MERGE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: { mergedKeys: result.mergedKeys },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_MCP_SERVERS_MERGE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to merge MCP servers",
      data: { mergedKeys: [] },
    });
  }
};

export const handleMcpServersRemove: CommandHandler = async (command, deps) => {
  const keys = readMcpServerKeys(command.payload);

  if (!keys) {
    return createEventMessage(RUNTIME_MCP_SERVERS_REMOVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error: "keys is required and must be a non-empty array of strings",
      data: { removedKeys: [] },
    });
  }

  try {
    const result = await deps.gatewayClient.requestGatewayControl<{
      removedKeys: string[];
    }>("/mcp/servers/remove", { keys });

    return createEventMessage(RUNTIME_MCP_SERVERS_REMOVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: true,
      data: { removedKeys: result.removedKeys },
    });
  } catch (error) {
    return createEventMessage(RUNTIME_MCP_SERVERS_REMOVE_RESULT, command.id, {
      commandId: command.id,
      instanceId: deps.getRuntimeInstanceId(),
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to remove MCP servers",
      data: { removedKeys: [] },
    });
  }
};
