import {
  buildRuntimeResultEventId,
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_NODES_PENDING_LIST,
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_MCP_SERVERS_MERGE,
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
  type Command
} from "@opengroow/protocol";

export type RuntimeEvent = {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
};

export function buildCommandEvent(command: Command, instanceId: string): RuntimeEvent | null {
  if (!command.id) return null;

  const p =
    command.payload !== null &&
    command.payload !== undefined &&
    typeof command.payload === "object" &&
    !Array.isArray(command.payload)
      ? (command.payload as Record<string, unknown>)
      : undefined;

  if (command.type === RUNTIME_NODES_PENDING_LIST) {
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_NODES_PENDING_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok: true,
        data: {
          output: "pending requests:\n- 5d202278-59aa-409f-870d-1f20fc9a07b3",
          requestIds: ["5d202278-59aa-409f-870d-1f20fc9a07b3"]
        }
      },
      ts: Date.now()
    };
  }

  if (command.type === RUNTIME_NODES_APPROVE) {
    const requestId = typeof p?.requestId === "string" ? p.requestId.trim() : "";
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_NODES_APPROVE_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok: requestId.length > 0,
        error: requestId.length > 0 ? undefined : "requestId is required",
        data: {
          output: requestId.length > 0 ? `approved ${requestId}` : "",
          requestId
        }
      },
      ts: Date.now()
    };
  }

  if (command.type === RUNTIME_WORKSPACE_CREATE) {
    const workspaceKey = typeof p?.workspaceKey === "string" ? p.workspaceKey : "";
    const label = typeof p?.label === "string" ? p.label : "";
    const ok = workspaceKey.length > 0 && label.length > 0;
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_WORKSPACE_CREATE_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok,
        error: ok ? undefined : workspaceKey.length === 0 ? "workspaceKey is required" : "label is required",
        data: { workspaceKey }
      },
      ts: Date.now()
    };
  }

  if (command.type === RUNTIME_WORKSPACE_FILE_WRITE) {
    const workspaceKey = typeof p?.workspaceKey === "string" ? p.workspaceKey : "";
    const filePath = typeof p?.filePath === "string" ? p.filePath : "";
    const content = typeof p?.content === "string" ? p.content : null;
    const ok = workspaceKey.length > 0 && filePath.length > 0 && content !== null;
    const error = ok
      ? undefined
      : workspaceKey.length === 0
        ? "workspaceKey is required"
        : filePath.length === 0
          ? "filePath is required"
          : "content is required";
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok,
        error,
        data: { workspaceKey, filePath }
      },
      ts: Date.now()
    };
  }

  if (command.type === RUNTIME_MCP_SERVERS_MERGE) {
    const servers =
      p?.servers && typeof p.servers === "object" && !Array.isArray(p.servers)
        ? (p.servers as Record<string, unknown>)
        : null;
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_MCP_SERVERS_MERGE_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok: servers !== null,
        error: servers !== null ? undefined : "servers is required",
        data: { mergedKeys: servers ? Object.keys(servers) : [] }
      },
      ts: Date.now()
    };
  }

  if (command.type === RUNTIME_MCP_SERVERS_REMOVE) {
    const keys = Array.isArray(p?.keys) ? (p.keys as string[]) : null;
    return {
      id: buildRuntimeResultEventId(command.id),
      type: RUNTIME_MCP_SERVERS_REMOVE_RESULT,
      payload: {
        commandId: command.id,
        instanceId,
        ok: keys !== null,
        error: keys !== null ? undefined : "keys is required",
        data: { removedKeys: keys ?? [] }
      },
      ts: Date.now()
    };
  }

  return null;
}
