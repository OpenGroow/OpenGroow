"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import type { FunctionReference } from "convex/server";
import {
  RUNTIME_NODES_PENDING_LIST,
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_CHECK,
  RUNTIME_WHATSAPP_PAIR_START,
  RUNTIME_WHATSAPP_PAIR_WAIT,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_TELEGRAM_CONFIG_SET,
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_DELETE,
  RUNTIME_WORKSPACE_SKILL_FILES,
} from "@opengroow/protocol";
import {
  parseRuntimeHealthPayload,
  parseRuntimeOpenClawExecPayload,
  parseRuntimeWhatsAppPairPayload,
  parseRuntimeWhatsAppConfigPayload,
  parseRuntimeTelegramConfigPayload,
  parseRuntimeAiConfigPayload,
  parseRuntimeSpeechToTextConfigPayload,
} from "./runtime_commands_node_parsers";
export { parseRuntimeHealthPayload } from "./runtime_commands_node_parsers";
import { env } from "./env";

export type EnqueueCommandArgs = {
  instanceId: string;
  type: string;
  payload?: unknown;
};

export type EnqueueCommandResult = {
  status: number;
  accepted: boolean;
  commandId: Id<"commands">;
};

export type InternalCommand = {
  instanceId: string;
  status: string;
  type: string;
  payload: unknown;
  createdAt: number;
};

export type RuntimeResultQueryResult = {
  status: number;
  found: boolean;
  error?: string;
  type?: string;
  payload?: unknown;
  ts?: number;
};

type OpenClawVersionRefreshResult = {
  ok: boolean;
  version?: string;
  output: string;
  error?: string;
  updatedAt?: string;
};

const OPENCLAW_VERSION_COMMAND_TIMEOUT_MS = 30_000;
const OPENCLAW_VERSION_REFRESH_MAX_ATTEMPTS = 6;
const OPENCLAW_VERSION_REFRESH_RETRY_DELAY_MS = 5_000;

// Break circular inference between generated api typings and local action declarations.
export const enqueueCommandMutation = api.commands
  .enqueue as unknown as FunctionReference<
  "mutation",
  "public",
  EnqueueCommandArgs,
  EnqueueCommandResult
>;

const enqueueInteractiveCommandMutation = internal.commands
  .enqueueInteractive as unknown as FunctionReference<
  "mutation",
  "internal",
  EnqueueCommandArgs,
  EnqueueCommandResult
>;

const dispatchCommandAction = internal.commands_node
  .dispatch as unknown as FunctionReference<
  "action",
  "internal",
  {
    commandId: Id<"commands">;
    bypassCoalescing?: boolean;
    retryOnFailure?: boolean;
  },
  Record<string, unknown>
>;

/**
 * Persist an interactive Runtime command, then attempt delivery before the
 * dashboard action returns. Unlike background enqueue, this mutation does not
 * schedule a second delivery attempt.
 *
 * Interactive delivery failures are terminal: the caller gets the failed
 * command immediately and can offer an explicit retry without an older
 * command unexpectedly replaying later. Background callers continue using
 * `enqueueCommandMutation` directly and retain scheduler retry/backoff.
 */
export async function enqueueInteractiveCommand(
  ctx: ActionCtx,
  args: EnqueueCommandArgs,
): Promise<EnqueueCommandResult> {
  const enqueued = await ctx.runMutation(enqueueInteractiveCommandMutation, args);
  if (!enqueued.accepted || !enqueued.commandId) return enqueued;

  await ctx.runAction(dispatchCommandAction, {
    commandId: enqueued.commandId,
    bypassCoalescing: true,
    retryOnFailure: false,
  });
  return enqueued;
}

const getRuntimeEventResultQuery = api.events
  .getRuntimeCommandResult as unknown as FunctionReference<
  "query",
  "public",
  { instanceId: string; commandId: Id<"commands"> },
  RuntimeResultQueryResult
>;

const getCommandResultFastQuery = internal.events
  .getCommandResultFast as unknown as FunctionReference<
  "query",
  "internal",
  { instanceId: string; commandId: Id<"commands"> },
  RuntimeResultQueryResult
>;

export const getInternalCommandQuery = internal.commands
  .getCommand as unknown as FunctionReference<
  "query",
  "internal",
  { commandId: Id<"commands"> },
  InternalCommand | null
>;

export const requestNodesPending = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_NODES_PENDING_LIST,
      payload: {},
    });
  },
});

export const requestNodeApprove = action({
  args: { instanceId: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_NODES_APPROVE,
      payload: { requestId: args.requestId.trim() },
    });
  },
});

export const requestNodesCheck = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_NODES_CHECK,
      payload: {},
    });
  },
});

export const requestWhatsAppPairStart = action({
  args: {
    instanceId: v.string(),
    force: v.optional(v.boolean()),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WHATSAPP_PAIR_START,
      payload: {
        force: args.force,
        timeoutMs: args.timeoutMs,
      },
    });
  },
});

export const requestWhatsAppConfigSet = action({
  args: {
    instanceId: v.string(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WHATSAPP_CONFIG_SET,
      payload: {
        phoneNumber: args.phoneNumber.trim(),
      },
    });
  },
});

export const requestWhatsAppPairWait = action({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WHATSAPP_PAIR_WAIT,
      payload: {
        timeoutMs: args.timeoutMs,
      },
    });
  },
});

export const requestTelegramConfigSet = action({
  args: {
    instanceId: v.string(),
    botToken: v.string(),
    dmPolicy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_TELEGRAM_CONFIG_SET,
      payload: {
        botToken: args.botToken.trim(),
        dmPolicy: args.dmPolicy,
      },
    });
  },
});

export const requestAiConfigSet = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    apiKey: v.optional(v.string()),
    model: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payload: Record<string, string> = {
      provider: args.provider.trim(),
      model: args.model.trim(),
    };
    if (args.apiKey?.trim()) {
      payload.apiKey = args.apiKey.trim();
    }
    if (args.baseUrl?.trim()) {
      payload.baseUrl = args.baseUrl.trim();
    }
    const dispatch = await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_AI_CONFIG_SET,
      payload,
    });

    // Wait for the runtime to actually confirm the config change, the same
    // way activateSubscriptionProvider/activateAuthOrderProvider do — a
    // fire-and-forget enqueue here resolved almost instantly, which made the
    // "Activating…" loader on the Providers page flash too briefly to notice
    // when switching to an apikey Provider (see providers-page-content.tsx).
    const brokerResult = await waitForRuntimeEvent(ctx, args.instanceId, dispatch.commandId);
    if (!brokerResult.found) {
      return {
        ...dispatch,
        status: brokerResult.status === 500 ? 502 : 504,
        error:
          brokerResult.status === 500
            ? "Runtime AI config command dispatch failed"
            : "Runtime AI config command timed out",
      };
    }

    const parsed = parseRuntimeAiConfigPayload(brokerResult.type, brokerResult.payload);
    if (!parsed) {
      return { ...dispatch, status: 500, error: "Unexpected runtime AI config response" };
    }
    if (!parsed.ok) {
      return { ...dispatch, status: 400, error: parsed.error ?? "Failed to set AI config" };
    }

    return { ...dispatch, status: 200, error: undefined };
  },
});

export const requestSpeechToTextConfigSet = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    enabled: v.boolean(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
      payload: {
        provider: args.provider.trim(),
        enabled: args.enabled,
        apiKey: args.apiKey?.trim(),
      },
    });
  },
});

export const requestOpenClawExec = action({
  args: {
    instanceId: v.string(),
    commandText: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: args.commandText.trim(),
        timeoutMs: args.timeoutMs,
      },
    });
  },
});

export const requestWorkspaceList = action({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WORKSPACE_LIST,
      payload: {},
    });
  },
});

export const requestWorkspaceFileRead = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WORKSPACE_FILE_READ,
      payload: {
        workspaceKey: args.workspaceKey.trim(),
        filePath: args.filePath.trim(),
      },
    });
  },
});

export const requestWorkspaceSkillFiles = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    spec: v.string(),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WORKSPACE_SKILL_FILES,
      payload: {
        workspaceKey: args.workspaceKey.trim(),
        spec: args.spec.trim(),
      },
    });
  },
});

export const requestWorkspaceFileDelete = action({
  args: {
    instanceId: v.string(),
    workspaceKey: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    return await enqueueInteractiveCommand(ctx, {
      instanceId: args.instanceId,
      type: RUNTIME_WORKSPACE_FILE_DELETE,
      payload: {
        workspaceKey: args.workspaceKey.trim(),
        filePath: args.filePath.trim(),
      },
    });
  },
});

export const refreshOpenClawVersion = action({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await refreshOpenClawVersionForInstance(ctx, args.instanceId, {
      timeoutMs: args.timeoutMs,
    });
  },
});

export const getRuntimeCommandResult = action({
  args: {
    commandId: v.id("commands"),
  },
  handler: async (ctx, args) => {
    const command = await ctx.runQuery(getInternalCommandQuery, {
      commandId: args.commandId,
    });
    if (!command) {
      return { status: 404, done: true, error: "Command not found" };
    }

    const brokerResult = (await ctx.runQuery(getRuntimeEventResultQuery, {
      instanceId: command.instanceId,
      commandId: args.commandId,
    })) as {
      status: number;
      found: boolean;
      error?: string;
      type?: string;
      payload?: unknown;
    };

    if (brokerResult.found && brokerResult.type && brokerResult.payload) {
      await persistChannelStateFromRuntimeResult(
        ctx,
        command.instanceId,
        brokerResult.type,
        brokerResult.payload,
      );
      return {
        status: 200,
        done: true,
        source: "broker",
        commandStatus: command.status,
        type: brokerResult.type,
        payload: brokerResult.payload,
      };
    }

    if ((brokerResult.status >= 400 && brokerResult.status !== 404) || brokerResult.error) {
      return {
        status: brokerResult.status,
        done: true,
        source: "broker",
        error: brokerResult.error ?? "Invalid runtime result",
      };
    }

    if (command.status === "failed") {
      return {
        status: 500,
        done: true,
        source: "broker",
        commandStatus: command.status,
        error: "Command dispatch failed before runtime result",
      };
    }

    return {
      status: 202,
      done: false,
      source: "broker",
      commandStatus: command.status,
      elapsedMs: Date.now() - command.createdAt,
    };
  },
});

async function persistChannelStateFromRuntimeResult(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload: unknown,
): Promise<void> {
  const updatedAt = new Date().toISOString();

  const whatsAppConfig = parseRuntimeWhatsAppConfigPayload(type, payload);
  if (whatsAppConfig?.ok) {
    await ctx.runMutation(
      internal.instances.setWhatsAppChannelStateByOpenclawId,
      {
        openclawId: instanceId,
        linked: false,
        connected: false,
        phoneNumber: whatsAppConfig.data.phoneNumber,
        configSyncedAt: updatedAt,
        updatedAt,
      },
    );
    return;
  }

  const whatsAppPair = parseRuntimeWhatsAppPairPayload(type, payload);
  if (
    whatsAppPair?.ok &&
    (whatsAppPair.data.connected || whatsAppPair.data.linked)
  ) {
    await ctx.runMutation(
      internal.instances.setWhatsAppChannelStateByOpenclawId,
      {
        openclawId: instanceId,
        linked:
          whatsAppPair.data.linked === true ||
          whatsAppPair.data.connected === true,
        connected: whatsAppPair.data.connected === true,
        updatedAt,
      },
    );
    return;
  }

  const telegramConfig = parseRuntimeTelegramConfigPayload(type, payload);
  if (telegramConfig?.ok) {
    await ctx.runMutation(
      internal.instances.setTelegramChannelStateByOpenclawId,
      {
        openclawId: instanceId,
        configured: true,
        updatedAt,
      },
    );
    return;
  }

  const aiConfig = parseRuntimeAiConfigPayload(type, payload);
  if (aiConfig?.ok && aiConfig.data.provider && aiConfig.data.model) {
    await ctx.runMutation(
      internal.instances.upsertProviderByOpenclawId,
      {
        openclawId: instanceId,
        kind: "apikey",
        provider: aiConfig.data.provider,
        model: aiConfig.data.model,
        baseUrl: aiConfig.data.baseUrl,
        updatedAt,
      },
    );
    return;
  }

  const speechToTextConfig = parseRuntimeSpeechToTextConfigPayload(type, payload);
  if (speechToTextConfig?.ok) {
    await ctx.runMutation(
      internal.instances.setSpeechToTextStateByOpenclawId,
      {
        openclawId: instanceId,
        provider: speechToTextConfig.data.provider ?? "groq",
        enabled: speechToTextConfig.data.enabled === true,
        updatedAt,
      },
    );
    return;
  }

  if (type === RUNTIME_WORKSPACE_LIST_RESULT) {
    const p = payload as Record<string, unknown> | undefined;
    if (p?.ok === true && p.data && typeof p.data === "object") {
      const data = p.data as Record<string, unknown>;
      const raw = Array.isArray(data.workspaces) ? data.workspaces : [];
      const workspaces = raw
        .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
        .map((w) => ({
          workspaceKey: typeof w.workspaceKey === "string" ? w.workspaceKey : "",
          label: typeof w.label === "string" ? w.label : "",
          absolutePath: typeof w.absolutePath === "string" ? w.absolutePath : "",
          isActive: w.isActive === true,
          kind: typeof w.kind === "string" ? w.kind : "custom",
          availableFiles: (Array.isArray(w.availableFiles) ? w.availableFiles : [])
            .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
            .map((f) => ({
              filePath: typeof f.filePath === "string" ? f.filePath : "",
              title: typeof f.title === "string" ? f.title : "",
              kind: typeof f.kind === "string" ? f.kind : "standard",
            }))
            .filter((f) => f.filePath),
        }))
        .filter((w) => w.workspaceKey);
      await ctx.runMutation(internal.instances.setWorkspaceListByOpenclawId, {
        openclawId: instanceId,
        workspaces,
        updatedAt,
      });
    }
  }
}

export async function refreshOpenClawVersionForInstance(
  ctx: ActionCtx,
  instanceId: string,
  options?: {
    timeoutMs?: number;
    attempts?: number;
    retryDelayMs?: number;
  },
): Promise<OpenClawVersionRefreshResult> {
  const timeoutMs = Math.max(
    1_000,
    options?.timeoutMs ?? OPENCLAW_VERSION_COMMAND_TIMEOUT_MS,
  );
  const attempts = Math.max(
    1,
    options?.attempts ?? OPENCLAW_VERSION_REFRESH_MAX_ATTEMPTS,
  );
  const retryDelayMs = Math.max(
    250,
    options?.retryDelayMs ?? OPENCLAW_VERSION_REFRESH_RETRY_DELAY_MS,
  );

  let lastError = "OpenClaw version refresh failed";
  let lastOutput = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dispatch = await enqueueInteractiveCommand(ctx, {
      instanceId: instanceId.trim(),
      type: RUNTIME_OPENCLAW_EXEC,
      payload: {
        commandText: "openclaw --version",
        timeoutMs,
      },
    });

    if (!dispatch.accepted || !dispatch.commandId) {
      lastError = "Failed to dispatch openclaw --version";
    } else {
      const brokerResult = await waitForRuntimeEvent(
        ctx,
        instanceId,
        dispatch.commandId,
        timeoutMs + 30_000,
      );

      const parsed = parseRuntimeOpenClawExecPayload(
        brokerResult.type,
        brokerResult.payload,
      );

      if (parsed?.ok) {
        const version = parsed.data.output.trim() || undefined;
        if (version) {
          const updatedAt = new Date().toISOString();
          await ctx.runMutation(
            internal.instances.setOpenClawVersionByOpenclawId,
            {
              openclawId: instanceId,
              version,
              updatedAt,
            },
          );
          return {
            ok: true,
            version,
            output: parsed.data.output,
            updatedAt,
          };
        }
        lastOutput = parsed.data.output;
        lastError = "OpenClaw version output was empty";
      } else if (parsed?.error) {
        lastOutput = parsed.data.output;
        lastError = parsed.error;
      } else {
        lastError = brokerResult.found
          ? "Unexpected OpenClaw exec result"
          : "Timed out waiting for openclaw --version";
      }
    }

    if (attempt < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  return {
    ok: false,
    output: lastOutput,
    error: lastError,
  };
}

export async function waitForRuntimeEvent(
  ctx: ActionCtx,
  instanceId: string,
  commandId: Id<"commands">,
  timeoutMs = env.RUNTIME_AUTH_BROKER_TIMEOUT_MS,
): Promise<RuntimeResultQueryResult> {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  const eventsFallbackAfterMs = 5_000;
  const start = Date.now();

  const initialCommand = await ctx.runQuery(getInternalCommandQuery, { commandId });
  if (initialCommand?.status === "failed") {
    return { status: 500, found: false };
  }

  let delay = 100;
  while (Date.now() < deadline) {
    const fastResult = await ctx.runQuery(getCommandResultFastQuery, {
      instanceId,
      commandId,
    });
    if (fastResult.found) {
      return fastResult;
    }

    if ((fastResult.status >= 400 && fastResult.status !== 404) || fastResult.error) {
      return fastResult;
    }

    if (Date.now() - start > eventsFallbackAfterMs) {
      const brokerResult = await ctx.runQuery(getRuntimeEventResultQuery, {
        instanceId,
        commandId,
      });
      if ((brokerResult.status >= 400 && brokerResult.status !== 404) || brokerResult.error) {
        return brokerResult;
      }
      if (brokerResult.found) {
        return brokerResult;
      }
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, 1_000);
  }
  return { status: 504, found: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
