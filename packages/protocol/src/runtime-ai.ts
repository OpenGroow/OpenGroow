export const RUNTIME_AI_CONFIG_SET = "runtime.ai.config.set" as const;
export const RUNTIME_AI_CONFIG_SET_RESULT = "runtime.ai.config.set.result" as const;
export const RUNTIME_SPEECH_TO_TEXT_CONFIG_SET = "runtime.speech_to_text.config.set" as const;
export const RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT =
  "runtime.speech_to_text.config.set.result" as const;

export type RuntimeAiConfigSetCommandPayload = {
  commandId?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export type RuntimeAiConfigSetResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
  };
};

export type RuntimeSpeechToTextConfigSetCommandPayload = {
  commandId?: string;
  provider?: string;
  enabled?: boolean;
  apiKey?: string;
};

export type RuntimeSpeechToTextConfigSetResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    provider?: string;
    enabled?: boolean;
  };
};
