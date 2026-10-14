export const RUNTIME_OPENCLAW_EXEC = "runtime.openclaw.exec" as const;
export const RUNTIME_OPENCLAW_EXEC_CANCEL = "runtime.openclaw.exec.cancel" as const;
export const RUNTIME_OPENCLAW_EXEC_RESULT = "runtime.openclaw.exec.result" as const;
export const RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT = "runtime.openclaw.exec.cancel.result" as const;

export type RuntimeOpenClawExecCommandPayload = {
  commandId?: string;
  commandText?: string;
  timeoutMs?: number;
  workspaceKey?: string;
  runFilePath?: string;
  outputsFilePath?: string;
  filesToWrite?: Array<{ filePath: string; content: string }>;
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
