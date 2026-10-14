export const RUNTIME_AGENT_CREDENTIAL_SET = "runtime.agent-credential.set" as const;
export const RUNTIME_AGENT_CREDENTIAL_SET_RESULT =
  "runtime.agent-credential.set.result" as const;

export type RuntimeAgentCredentialSetCommandPayload = {
  commandId?: string;
  agentId: string;
  apiKey: string;
};

export type RuntimeAgentCredentialSetResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    agentId: string;
  };
};
