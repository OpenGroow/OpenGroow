export const RUNTIME_TELEGRAM_CONFIG_SET = "runtime.telegram.config.set" as const;
export const RUNTIME_TELEGRAM_CONFIG_SET_RESULT = "runtime.telegram.config.set.result" as const;

export type RuntimeTelegramConfigSetCommandPayload = {
  commandId?: string;
  botToken?: string;
  dmPolicy?: string;
};

export type RuntimeTelegramConfigSetResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
  };
};
