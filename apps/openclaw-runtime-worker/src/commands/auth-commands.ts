import {
  RUNTIME_AUTH_ACTIVATE_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
} from "@opengroow/protocol";
import {
  readAuthEnter,
  readAuthInput,
  readAuthKind,
  readAuthModel,
  readAuthProvider,
  readAuthSessionId,
} from "./command-inputs.js";
import { createEventMessage } from "./event-message.js";
import type { CommandHandler } from "./types.js";

export type AuthInputResult = {
  body: Record<string, unknown>;
  failData: Record<string, unknown>;
  validationError?: string;
};

// Named generically (not "Auth") because it factors out the relay shape
// shared by every "post a payload to a control-socket route, wrap success/
// failure into a result event" runtime command handler — the auth family
// was just the first caller. RUNTIME_OPENCLAW_EXEC_CANCEL's handler
// (config-commands.ts) reuses it too.
export function makeGatewayCommandHandler(
  resultType: string,
  path: string,
  readInput: (payload: unknown) => AuthInputResult,
  errorMessage: string,
): CommandHandler {
  return async (command, deps) => {
    const { body, failData, validationError } = readInput(command.payload);

    if (validationError) {
      return createEventMessage(resultType, command.id, {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error: validationError,
        data: failData,
      });
    }

    try {
      const result = await deps.gatewayClient.requestGatewayControl<object>(path, body);
      return createEventMessage(resultType, command.id, {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: true,
        data: result,
      });
    } catch (error) {
      return createEventMessage(resultType, command.id, {
        commandId: command.id,
        instanceId: deps.getRuntimeInstanceId(),
        ok: false,
        error: error instanceof Error ? error.message : errorMessage,
        data: failData,
      });
    }
  };
}

// Local alias — every handleAuth* handler below predates the generic name
// and reads more clearly against its own "auth" vocabulary.
const makeAuthCommandHandler = makeGatewayCommandHandler;

export const handleAuthStart: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_START_RESULT,
  "/auth/start",
  (payload) => {
    const provider = readAuthProvider(payload);
    return {
      body: { provider },
      failData: { sessionId: "", provider, status: "failed", logs: [] },
    };
  },
  "Auth start failed",
);

export const handleAuthStatus: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_STATUS_RESULT,
  "/auth/status",
  (payload) => {
    const sessionId = readAuthSessionId(payload);
    return {
      body: { sessionId },
      failData: { sessionId, status: "failed", logs: [] },
      validationError: sessionId ? undefined : "sessionId is required",
    };
  },
  "Auth status failed",
);

export const handleAuthInput: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_INPUT_RESULT,
  "/auth/input",
  (payload) => {
    const sessionId = readAuthSessionId(payload);
    return {
      body: { sessionId, input: readAuthInput(payload), enter: readAuthEnter(payload) },
      failData: { sessionId, status: "failed", logs: [] },
      validationError: sessionId ? undefined : "sessionId is required",
    };
  },
  "Auth input failed",
);

export const handleAuthCancel: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_CANCEL_RESULT,
  "/auth/cancel",
  (payload) => {
    const sessionId = readAuthSessionId(payload);
    return {
      body: { sessionId },
      failData: { sessionId, status: "failed", logs: [] },
      validationError: sessionId ? undefined : "sessionId is required",
    };
  },
  "Auth cancel failed",
);

// Reactivates a provider already linked/configured from an earlier
// handleAuthStart or ai-config-set call, without repeating that flow. An
// optional model overrides the provider's hardcoded default — this is also
// how the dashboard edits a linked subscription's model in place.
export const handleAuthActivate: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_ACTIVATE_RESULT,
  "/auth/activate",
  (payload) => {
    const provider = readAuthProvider(payload);
    const model = readAuthModel(payload);
    return {
      body: { provider, ...(model ? { model } : {}) },
      failData: { provider },
    };
  },
  "Auth activate failed",
);

// Switches between two saved auth methods for the same provider id (an
// "apikey" and a "subscription" Provider) via auth.order.<provider> — see
// #289. Distinct from handleAuthActivate, which only ever flips
// agents.defaults.model.primary and can't disambiguate two credentials that
// already resolve to the same provider.
export const handleAuthOrderActivate: CommandHandler = makeAuthCommandHandler(
  RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
  "/auth/order-activate",
  (payload) => {
    const provider = readAuthProvider(payload);
    const kind = readAuthKind(payload);
    const model = readAuthModel(payload);
    return {
      body: { provider, kind, model },
      failData: { provider, kind, model },
      validationError:
        kind && model ? undefined : "kind and model are required",
    };
  },
  "Auth order activate failed",
);
