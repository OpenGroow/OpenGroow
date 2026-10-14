export const RUNTIME_WHATSAPP_PAIR_START = "runtime.whatsapp.pair.start" as const;
export const RUNTIME_WHATSAPP_PAIR_WAIT = "runtime.whatsapp.pair.wait" as const;
export const RUNTIME_WHATSAPP_CONFIG_SET = "runtime.whatsapp.config.set" as const;
export const RUNTIME_WHATSAPP_PAIR_START_RESULT = "runtime.whatsapp.pair.start.result" as const;
export const RUNTIME_WHATSAPP_PAIR_WAIT_RESULT = "runtime.whatsapp.pair.wait.result" as const;
export const RUNTIME_WHATSAPP_CONFIG_SET_RESULT = "runtime.whatsapp.config.set.result" as const;

export type RuntimeWhatsAppPairStartCommandPayload = {
  commandId?: string;
  force?: boolean;
  timeoutMs?: number;
};

export type RuntimeWhatsAppPairWaitCommandPayload = {
  commandId?: string;
  timeoutMs?: number;
};

export type RuntimeWhatsAppConfigSetCommandPayload = {
  commandId?: string;
  phoneNumber?: string;
};

export type RuntimeWhatsAppPairStartResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    linked?: boolean;
    connected: boolean;
    qrDataUrl?: string;
    // Time left on qrDataUrl when the Instance answered; absent without a QR.
    qrExpiresInMs?: number;
  };
};

export type RuntimeWhatsAppPairWaitResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    linked?: boolean;
    connected: boolean;
    qrDataUrl?: string;
    // Time left on qrDataUrl when the Instance answered; absent without a QR.
    qrExpiresInMs?: number;
  };
};

export type RuntimeWhatsAppConfigSetResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
    phoneNumber?: string;
    enabled?: boolean;
  };
};
