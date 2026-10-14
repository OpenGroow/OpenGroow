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
    turns: Array<{
      role: "user" | "assistant";
      text: string;
      timestamp?: string;
    }>;
  };
};
