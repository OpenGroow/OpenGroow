export const RUNTIME_AUTH_START = "runtime.auth.start" as const;
export const RUNTIME_AUTH_START_RESULT = "runtime.auth.start.result" as const;
export const RUNTIME_AUTH_STATUS = "runtime.auth.status" as const;
export const RUNTIME_AUTH_STATUS_RESULT = "runtime.auth.status.result" as const;
export const RUNTIME_AUTH_INPUT = "runtime.auth.input" as const;
export const RUNTIME_AUTH_INPUT_RESULT = "runtime.auth.input.result" as const;
export const RUNTIME_AUTH_CANCEL = "runtime.auth.cancel" as const;
export const RUNTIME_AUTH_CANCEL_RESULT = "runtime.auth.cancel.result" as const;
export const RUNTIME_AUTH_ACTIVATE = "runtime.auth.activate" as const;
export const RUNTIME_AUTH_ACTIVATE_RESULT = "runtime.auth.activate.result" as const;
export const RUNTIME_AUTH_ORDER_ACTIVATE = "runtime.auth.order-activate" as const;
export const RUNTIME_AUTH_ORDER_ACTIVATE_RESULT = "runtime.auth.order-activate.result" as const;

export type RuntimeAuthCommandPayload = {
  commandId?: string;
  sessionId?: string;
  provider?: string;
  input?: string;
  enter?: boolean;
  // RUNTIME_AUTH_ACTIVATE only: overrides the provider's hardcoded default
  // model when reactivating — lets the dashboard change a linked
  // subscription's model without repeating the OAuth exchange.
  model?: string;
};

// Switches which already-configured auth method is active for a provider id
// that has two saved credentials (an "apikey" and a "subscription" Provider,
// see GLOSSARY.md) — this can't reuse RuntimeAuthCommandPayload's
// agents.defaults.model.primary-only semantics, since both entries already
// resolve to the same provider id; auth.order.<provider> is what actually
// picks between them (see #289).
export type RuntimeAuthOrderActivateCommandPayload = {
  commandId?: string;
  provider: string;
  kind: "apikey" | "subscription";
  model: string;
};

export type RuntimeAuthOrderActivateResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    provider?: string;
    kind?: "apikey" | "subscription";
    model?: string;
    profileId?: string;
  };
};

export type RuntimeAuthStartCommandPayload = {
  commandId?: string;
  provider?: string;
};

export type RuntimeAuthStatusCommandPayload = {
  commandId?: string;
  sessionId: string;
};

export type RuntimeAuthInputCommandPayload = {
  commandId?: string;
  sessionId: string;
  input?: string;
  enter?: boolean;
};

export type RuntimeAuthSessionSnapshot = {
  sessionId: string;
  provider?: string;
  status: string;
  logs: string[];
  authUrl?: string;
};

export type RuntimeAuthStartResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: RuntimeAuthSessionSnapshot;
};

export type RuntimeAuthStatusResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: RuntimeAuthSessionSnapshot;
};

export type RuntimeAuthInputResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: RuntimeAuthSessionSnapshot;
};

export type RuntimeAuthResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    sessionId: string;
    provider?: string;
    status: string;
    logs: string[];
    authUrl?: string;
    error?: string;
  };
};
