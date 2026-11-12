export const RUNTIME_OPENCLAW_EXEC = "runtime.openclaw.exec" as const;
export const RUNTIME_OPENCLAW_EXEC_CANCEL = "runtime.openclaw.exec.cancel" as const;
export const RUNTIME_OPENCLAW_EXEC_RESULT = "runtime.openclaw.exec.result" as const;
export const RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT = "runtime.openclaw.exec.cancel.result" as const;

/**
 * `errorCode` of an exec result refused before the Agent session started
 * because a required MCP server failed its probe (`requiredMcpServers`).
 */
export const MCP_SERVER_UNREACHABLE = "mcp_server_unreachable" as const;

export type RuntimeOpenClawExecCommandPayload = {
  commandId?: string;
  commandText?: string;
  timeoutMs?: number;
  workspaceKey?: string;
  runFilePath?: string;
  outputsFilePath?: string;
  filesToWrite?: Array<{ filePath: string; content: string }>;
  /**
   * MCP servers (keys of `mcp.servers`) the session needs. The Worker probes
   * them from the Gateway first and fails the exec with
   * `MCP_SERVER_UNREACHABLE` instead of starting a session without their tools.
   */
  requiredMcpServers?: string[];
};

export type RuntimeOpenClawExecCancelCommandPayload = {
  commandId?: string;
  sessionId: string;
};

export type RuntimeOpenClawExecResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  /** Set when the failure has a known cause, e.g. `MCP_SERVER_UNREACHABLE`. */
  errorCode?: string;
  data: {
    output: string;
    commandText?: string;
    exitCode?: number | null;
  };
};

export type RuntimeOpenClawExecCancelResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    cancelled: boolean;
  };
};
