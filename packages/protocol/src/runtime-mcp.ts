export const RUNTIME_MCP_SERVERS_MERGE = "runtime.mcp.servers.merge" as const;
export const RUNTIME_MCP_SERVERS_MERGE_RESULT = "runtime.mcp.servers.merge.result" as const;
export const RUNTIME_MCP_SERVERS_REMOVE = "runtime.mcp.servers.remove" as const;
export const RUNTIME_MCP_SERVERS_REMOVE_RESULT = "runtime.mcp.servers.remove.result" as const;

export type RuntimeMcpServersMergeCommandPayload = {
  commandId?: string;
  servers: Record<string, Record<string, unknown>>;
};

export type RuntimeMcpServersMergeResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    mergedKeys: string[];
  };
};

export type RuntimeMcpServersRemoveCommandPayload = {
  commandId?: string;
  keys: string[];
};

export type RuntimeMcpServersRemoveResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    removedKeys: string[];
  };
};
