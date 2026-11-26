export const RUNTIME_SESSION_TRANSCRIPT_READ = "runtime.session.transcript.read" as const;
export const RUNTIME_SESSION_TRANSCRIPT_READ_RESULT =
  "runtime.session.transcript.read.result" as const;

export type RuntimeSessionTranscriptReadCommandPayload = {
  commandId?: string;
  agentName: string;
  sessionKey?: string;
};

export type RuntimeSessionTranscriptReadResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    found: boolean;
    turns: RuntimeSessionTranscriptTurn[];
  };
};

/** One transcript turn. `toolCallId` is the native id pairing a tool call with its result; optional for older transcripts. */
export type RuntimeSessionTranscriptTurn =
  | { kind?: "message"; role: "user" | "assistant"; text: string; timestamp?: string }
  | { kind: "tool_call"; toolName: string; toolCallId?: string; arguments?: unknown; timestamp?: string }
  | {
      kind: "tool_result";
      toolName: string;
      toolCallId?: string;
      success: boolean;
      result?: unknown;
      timestamp?: string;
    };
