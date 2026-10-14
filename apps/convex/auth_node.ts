"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  RUNTIME_AUTH_START,
  RUNTIME_AUTH_STATUS,
  RUNTIME_AUTH_INPUT,
  RUNTIME_AUTH_CANCEL,
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_ORDER_ACTIVATE,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AUTH_ACTIVATE_RESULT,
  RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
} from "@opengroow/protocol";
import {
  waitForRuntimeEvent,
  enqueueInteractiveCommand,
} from "./runtime_commands_node";

type AuthActionResponse = {
  status?: number;
  error?: string;
  job?: {
    id?: string;
    status?: string;
    logs?: string[];
    error?: string;
    awaitingResume?: boolean;
  };
};

type RuntimeAuthResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    sessionId?: string;
    provider?: string;
    model?: string;
    status: string;
    logs: string[];
    authUrl?: string;
    error?: string;
    awaitingResume?: boolean;
  };
};

export const startAuth = action({
  args: {
    instanceId: v.optional(v.string()),
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId?.trim();
    if (!instanceId) {
      return {
        status: 409,
        error:
          "instanceId is required once the runtime is expected to be operational",
      };
    }
    return await dispatchRuntimeAuthCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_START,
      {
        provider: args.provider?.trim() || "openai",
      },
    );
  },
});

export const getAuthJob = action({
  args: { jobId: v.string(), instanceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId?.trim();
    if (!instanceId) {
      return {
        status: 409,
        error:
          "instanceId is required once the runtime is expected to be operational",
      };
    }
    return await dispatchRuntimeAuthCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_STATUS,
      {
        sessionId: args.jobId.trim(),
      },
    );
  },
});

export const cancelAuth = action({
  args: {
    jobId: v.string(),
    instanceId: v.optional(v.string()),
    serverId: v.optional(v.number()),
    ipv4: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId?.trim();
    if (!instanceId) {
      return {
        status: 409,
        error:
          "instanceId is required once the runtime is expected to be operational",
      };
    }
    const result = await dispatchRuntimeAuthCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_CANCEL,
      {
        sessionId: args.jobId.trim(),
      },
    );
    if (result.job?.status === "cancelled") {
      return {
        ...result,
        status: 200,
        error: undefined,
      };
    }
    return result;
  },
});

// Shared dispatch → wait → parse scaffolding for the three "activate a
// provider via RUNTIME_AUTH_ACTIVATE-family command" actions below. They
// differ only in which command/result type they use and what they persist
// on success, so this is where that duplication lives instead of each action
// re-inlining enqueueCommandMutation/waitForRuntimeEvent/status-mapping.
// Activating a provider rewrites openclaw.json through the OpenClaw CLI, which
// takes 2-5 s on an idle Instance and was measured at ~16 s right after a
// provider switch (the Gateway hot-reloads and rewrites the file; the control
// socket then retries the write). The 15 s default cut those off.
const AUTH_ACTIVATE_TIMEOUT_MS = 60_000;

async function dispatchAuthActivateCommand(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  resultType: string,
  payload: unknown,
): Promise<
  | { ok: true; parsed: { ok: boolean; error?: string; model?: string } }
  | { ok: false; status: number; error: string }
> {
  const dispatch = await enqueueInteractiveCommand(ctx, { instanceId, type, payload });
  const brokerResult = await waitForRuntimeEvent(
    ctx,
    instanceId,
    dispatch.commandId,
    AUTH_ACTIVATE_TIMEOUT_MS,
  );
  if (!brokerResult.found) {
    return {
      ok: false,
      status: brokerResult.status === 500 ? 502 : 504,
      error:
        brokerResult.status === 500
          ? "Runtime auth command dispatch failed"
          : "Runtime auth command timed out",
    };
  }

  const parsed = parseRuntimeActivateLikePayload(brokerResult.type, brokerResult.payload, resultType);
  if (!parsed) {
    return { ok: false, status: 500, error: "Unexpected runtime auth response" };
  }
  return { ok: true, parsed };
}

function parseRuntimeActivateLikePayload(
  type: string | undefined,
  payload: unknown,
  expectedType: string,
): { ok: boolean; error?: string; model?: string } | null {
  if (type !== expectedType) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  const dataRecord = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    ok: payloadRecord.ok !== false,
    error: typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    model: typeof dataRecord.model === "string" ? dataRecord.model : undefined,
  };
}

// Reactivates an already-linked OAuth subscription Provider (agents.defaults.model.primary)
// without repeating the OAuth exchange. Only for kind "subscription" — an
// "apikey" Provider is reactivated by resubmitting its stored model via
// requestAiConfigSet instead (see providers-page-content.tsx).
export const activateSubscriptionProvider = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId.trim();
    const provider = args.provider.trim();
    const model = args.model?.trim();
    if (!instanceId || !provider) {
      return { status: 400, error: "instanceId and provider are required" };
    }

    const result = await dispatchAuthActivateCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_ACTIVATE,
      RUNTIME_AUTH_ACTIVATE_RESULT,
      { provider, ...(model ? { model } : {}) },
    );
    if (!result.ok) {
      return { status: result.status, error: result.error };
    }
    if (!result.parsed.ok || !result.parsed.model) {
      return { status: 400, error: result.parsed.error ?? "Failed to reactivate provider" };
    }

    await ctx.runMutation(internal.instances.setProviderActiveByOpenclawId, {
      openclawId: instanceId,
      kind: "subscription",
      provider,
      updatedAt: new Date().toISOString(),
    });

    return { status: 200, provider, model: result.parsed.model };
  },
});

// Changes which model an already-linked OAuth subscription Provider uses,
// without repeating the OAuth exchange — the subscription-side equivalent of
// editing an apikey Provider's model via requestAiConfigSet. Passing an
// explicit `model` overrides handleAuthActivate's hardcoded per-provider
// default and, like requestAiConfigSet's existing behaviour for apikey
// Providers, also activates it (see providers-page-content.tsx).
export const updateSubscriptionModel = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId.trim();
    const provider = args.provider.trim();
    const model = args.model.trim();
    if (!instanceId || !provider || !model) {
      return { status: 400, error: "instanceId, provider, and model are required" };
    }

    const result = await dispatchAuthActivateCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_ACTIVATE,
      RUNTIME_AUTH_ACTIVATE_RESULT,
      { provider, model },
    );
    if (!result.ok) {
      return { status: result.status, error: result.error };
    }
    if (!result.parsed.ok || !result.parsed.model) {
      return { status: 400, error: result.parsed.error ?? "Failed to update subscription model" };
    }

    await ctx.runMutation(internal.instances.upsertProviderByOpenclawId, {
      openclawId: instanceId,
      kind: "subscription",
      provider,
      model: result.parsed.model,
      updatedAt: new Date().toISOString(),
    });

    return { status: 200, provider, model: result.parsed.model };
  },
});

// Switches which already-configured auth method is active for a provider id
// that has two saved credentials — an "apikey" and a "subscription" Provider
// sharing the same canonical provider id (e.g. an OpenAI API key configured
// alongside a linked ChatGPT/Codex OAuth subscription). Unlike
// activateSubscriptionProvider/requestAiConfigSet, this writes
// auth.order.<provider> on the runtime side (via RUNTIME_AUTH_ORDER_ACTIVATE)
// before flipping model.primary, since both entries already resolve to the
// same provider and OpenClaw picks between them by auth order, not by model.
// See #289 and providers-page-content.tsx's isSwitchingSameProviderAuth.
export const activateAuthOrderProvider = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    kind: v.union(v.literal("apikey"), v.literal("subscription")),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId.trim();
    const provider = args.provider.trim();
    const model = args.model.trim();
    if (!instanceId || !provider || !model) {
      return { status: 400, error: "instanceId, provider, and model are required" };
    }

    const result = await dispatchAuthActivateCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_ORDER_ACTIVATE,
      RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
      { provider, kind: args.kind, model },
    );
    if (!result.ok) {
      return { status: result.status, error: result.error };
    }
    if (!result.parsed.ok) {
      return { status: 400, error: result.parsed.error ?? "Failed to switch auth method for this provider" };
    }

    await ctx.runMutation(internal.instances.setProviderActiveByOpenclawId, {
      openclawId: instanceId,
      kind: args.kind,
      provider,
      updatedAt: new Date().toISOString(),
    });

    return { status: 200, provider, kind: args.kind, model };
  },
});

export const sendAuthInput = action({
  args: {
    jobId: v.string(),
    instanceId: v.optional(v.string()),
    input: v.optional(v.string()),
    enter: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const instanceId = args.instanceId?.trim();
    if (!instanceId) {
      return {
        status: 409,
        error:
          "instanceId is required once the runtime is expected to be operational",
      };
    }
    return await dispatchRuntimeAuthCommand(
      ctx,
      instanceId,
      RUNTIME_AUTH_INPUT,
      {
        sessionId: args.jobId.trim(),
        input: args.input,
        enter: args.enter,
      },
    );
  },
});

async function dispatchRuntimeAuthCommand(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload?: unknown,
): Promise<AuthActionResponse> {
  const trimmedInstanceId = instanceId.trim();
  if (!trimmedInstanceId) {
    return { status: 400, error: "instanceId is required" };
  }

  const dispatch = await enqueueInteractiveCommand(ctx, {
    instanceId: trimmedInstanceId,
    type,
    payload,
  });
  const brokerResult = await waitForRuntimeEvent(
    ctx,
    trimmedInstanceId,
    dispatch.commandId,
  );
  if (!brokerResult.found) {
    if (brokerResult.status === 500) {
      return { status: 502, error: "Runtime auth command dispatch failed" };
    }
    return { status: 504, error: "Runtime auth command timed out" };
  }

  const parsed = parseRuntimeAuthPayload(
    brokerResult.type,
    brokerResult.payload,
  );
  if (!parsed) {
    return { status: 500, error: "Unexpected runtime auth response" };
  }

  if (parsed.ok && parsed.data.status === "succeeded") {
    await persistManagedAuthSuccess(
      ctx,
      trimmedInstanceId,
      parsed.data.provider,
      parsed.data.model,
    );
  }

  const terminalError =
    parsed.data.status === "failed" || parsed.data.status === "cancelled"
      ? (parsed.data.error ?? parsed.error ?? "Runtime auth failed")
      : parsed.error;

  return {
    status: parsed.ok && !terminalError ? 200 : 400,
    error: terminalError,
    job: {
      id: parsed.data.sessionId,
      status: parsed.data.status,
      logs: parsed.data.logs,
      error: terminalError,
      awaitingResume: parsed.data.awaitingResume,
    },
  };
}

async function persistManagedAuthSuccess(
  ctx: ActionCtx,
  instanceId: string,
  provider: string | undefined,
  model: string | undefined,
): Promise<void> {
  const trimmedInstanceId = instanceId.trim();
  const trimmedModel = model?.trim();
  if (!trimmedInstanceId || !trimmedModel) {
    return;
  }

  await ctx.runMutation(internal.instances.upsertProviderByOpenclawId, {
    openclawId: trimmedInstanceId,
    kind: "subscription",
    provider: provider?.trim() || "openai",
    model: trimmedModel,
    updatedAt: new Date().toISOString(),
  });
}

function parseRuntimeAuthPayload(
  type: string | undefined,
  payload: unknown,
): RuntimeAuthResultPayload | null {
  if (
    type !== RUNTIME_AUTH_START_RESULT &&
    type !== RUNTIME_AUTH_STATUS_RESULT &&
    type !== RUNTIME_AUTH_INPUT_RESULT &&
    type !== RUNTIME_AUTH_CANCEL_RESULT
  ) {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const data = payloadRecord.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  const sessionId =
    typeof dataRecord.sessionId === "string" &&
    dataRecord.sessionId.trim().length > 0
      ? dataRecord.sessionId
      : undefined;
  const status =
    typeof dataRecord.status === "string" && dataRecord.status.trim().length > 0
      ? dataRecord.status
      : payloadRecord.ok === false
        ? "failed"
        : "";
  const logs = Array.isArray(dataRecord.logs)
    ? dataRecord.logs.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (!status) {
    return null;
  }

  return {
    commandId:
      typeof payloadRecord.commandId === "string"
        ? payloadRecord.commandId
        : "",
    instanceId:
      typeof payloadRecord.instanceId === "string"
        ? payloadRecord.instanceId
        : "",
    ok: payloadRecord.ok !== false,
    error:
      typeof payloadRecord.error === "string" ? payloadRecord.error : undefined,
    data: {
      sessionId,
      provider:
        typeof dataRecord.provider === "string"
          ? dataRecord.provider
          : undefined,
      // Without this, persistManagedAuthSuccess always receives model:
      // undefined and silently no-ops on its `!trimmedModel` guard — the
      // dashboard shows "Subscription linked successfully" (from
      // authJob.status alone) while the Provider never appears in the
      // Provider Management table, since it was never upserted into Convex.
      model: typeof dataRecord.model === "string" ? dataRecord.model : undefined,
      status,
      logs,
      authUrl:
        typeof dataRecord.authUrl === "string" ? dataRecord.authUrl : undefined,
      error:
        typeof dataRecord.error === "string" ? dataRecord.error : undefined,
      awaitingResume: dataRecord.awaitingResume === true,
    },
  };
}
