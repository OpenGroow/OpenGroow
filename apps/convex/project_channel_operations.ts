"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_TELEGRAM_CONFIG_SET,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_WHATSAPP_PAIR_START,
  RUNTIME_WHATSAPP_PAIR_WAIT,
} from "@opengroow/protocol";
import { isOptionalPluginEnabled, WHATSAPP_PLUGIN_UNAVAILABLE } from "./optional_plugins.js";
import {
  enqueueInteractiveCommand,
  waitForRuntimeEvent,
} from "./runtime_commands_node";
import {
  parseRuntimeSpeechToTextConfigPayload,
  parseRuntimeTelegramConfigPayload,
  parseRuntimeWhatsAppConfigPayload,
  parseRuntimeWhatsAppPairPayload,
} from "./runtime_commands_node_parsers";

export type ProjectWhatsAppPairResult = {
  ok: boolean;
  output: string;
  linked: boolean;
  connected: boolean;
  qrDataUrl?: string;
  qrExpiresInMs?: number;
  error?: string;
};

export type ProjectWhatsAppConfigResult = {
  ok: boolean;
  output: string;
  phoneNumber?: string;
  enabled?: boolean;
  error?: string;
};

export type ProjectChannelConfigResult = {
  ok: boolean;
  output: string;
  error?: string;
};

export type ProjectSpeechToTextResult = ProjectChannelConfigResult & {
  provider?: string;
  enabled: boolean;
};

export async function readRuntimeResult(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload: unknown,
  waitTimeoutMs?: number,
): Promise<{ type?: string; payload?: unknown; error?: string }> {
  const dispatch = await enqueueInteractiveCommand(ctx, {
    instanceId,
    type,
    payload,
  });
  if (!dispatch.accepted || !dispatch.commandId) {
    return { error: "Runtime command was not accepted" };
  }
  const result = await waitForRuntimeEvent(
    ctx,
    instanceId,
    dispatch.commandId,
    waitTimeoutMs,
  );
  if (!result.found) {
    return {
      error:
        result.status === 500
          ? "Runtime command dispatch failed"
          : "Runtime command timed out",
    };
  }
  return { type: result.type, payload: result.payload };
}

export const configureWhatsApp = action({
  args: {
    instanceId: v.string(),
    phoneNumber: v.string(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ProjectWhatsAppConfigResult> => {
    if (!isOptionalPluginEnabled("whatsapp")) {
      return { ok: false, output: "", error: WHATSAPP_PLUGIN_UNAVAILABLE };
    }
    const instanceId = args.instanceId.trim();
    const result = await readRuntimeResult(ctx, instanceId, RUNTIME_WHATSAPP_CONFIG_SET, {
      phoneNumber: args.phoneNumber.trim(),
      ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
    });
    const parsed = parseRuntimeWhatsAppConfigPayload(result.type, result.payload);
    if (!parsed) {
      return { ok: false, output: "", error: result.error ?? "Unexpected WhatsApp result" };
    }
    if (parsed.ok) {
      const updatedAt = new Date().toISOString();
      await ctx.runMutation(internal.instances.setWhatsAppChannelStateByOpenclawId, {
        openclawId: instanceId,
        linked: false,
        connected: false,
        phoneNumber: parsed.data.phoneNumber,
        enabled: parsed.data.enabled,
        configSyncedAt: updatedAt,
        updatedAt,
      });
    }
    return {
      ok: parsed.ok,
      output: parsed.data.output,
      phoneNumber: parsed.data.phoneNumber,
      enabled: parsed.data.enabled,
      error: parsed.error,
    };
  },
});

async function pairWhatsApp(
  ctx: ActionCtx,
  instanceId: string,
  type: typeof RUNTIME_WHATSAPP_PAIR_START | typeof RUNTIME_WHATSAPP_PAIR_WAIT,
  payload: { force?: boolean; timeoutMs?: number },
): Promise<ProjectWhatsAppPairResult> {
  if (!isOptionalPluginEnabled("whatsapp")) {
    return { ok: false, output: "", linked: false, connected: false, error: WHATSAPP_PLUGIN_UNAVAILABLE };
  }
  const waitTimeoutMs = payload.timeoutMs === undefined ? undefined : payload.timeoutMs + 30_000;
  const result = await readRuntimeResult(ctx, instanceId, type, payload, waitTimeoutMs);
  const parsed = parseRuntimeWhatsAppPairPayload(result.type, result.payload);
  if (!parsed) {
    return {
      ok: false,
      output: "",
      linked: false,
      connected: false,
      error: result.error ?? "Unexpected WhatsApp pairing result",
    };
  }
  if (parsed.ok && (parsed.data.linked || parsed.data.connected)) {
    const updatedAt = new Date().toISOString();
    await ctx.runMutation(internal.instances.setWhatsAppChannelStateByOpenclawId, {
      openclawId: instanceId,
      linked: parsed.data.linked === true || parsed.data.connected === true,
      connected: parsed.data.connected === true,
      updatedAt,
    });
  }
  return {
    ok: parsed.ok,
    output: parsed.data.output,
    linked: parsed.data.linked === true || parsed.data.connected === true,
    connected: parsed.data.connected === true,
    qrDataUrl: "qrDataUrl" in parsed.data ? parsed.data.qrDataUrl : undefined,
    qrExpiresInMs: "qrExpiresInMs" in parsed.data ? parsed.data.qrExpiresInMs : undefined,
    error: parsed.error,
  };
}

export const startWhatsAppPairing = action({
  args: {
    instanceId: v.string(),
    force: v.optional(v.boolean()),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    pairWhatsApp(ctx, args.instanceId.trim(), RUNTIME_WHATSAPP_PAIR_START, {
      force: args.force,
      timeoutMs: args.timeoutMs,
    }),
});

export const waitWhatsAppPairing = action({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    pairWhatsApp(ctx, args.instanceId.trim(), RUNTIME_WHATSAPP_PAIR_WAIT, {
      timeoutMs: args.timeoutMs,
    }),
});

export const configureTelegram = action({
  args: {
    instanceId: v.string(),
    botToken: v.string(),
    dmPolicy: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProjectChannelConfigResult> => {
    const instanceId = args.instanceId.trim();
    const result = await readRuntimeResult(ctx, instanceId, RUNTIME_TELEGRAM_CONFIG_SET, {
      botToken: args.botToken.trim(),
      dmPolicy: args.dmPolicy,
    });
    const parsed = parseRuntimeTelegramConfigPayload(result.type, result.payload);
    if (!parsed) {
      return { ok: false, output: "", error: result.error ?? "Unexpected Telegram result" };
    }
    if (parsed.ok) {
      const updatedAt = new Date().toISOString();
      await ctx.runMutation(internal.instances.setTelegramChannelStateByOpenclawId, {
        openclawId: instanceId,
        configured: true,
        updatedAt,
      });
    }
    return { ok: parsed.ok, output: parsed.data.output, error: parsed.error };
  },
});

export const configureSpeechToText = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    enabled: v.boolean(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProjectSpeechToTextResult> => {
    const instanceId = args.instanceId.trim();
    const result = await readRuntimeResult(
      ctx,
      instanceId,
      RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
      {
        provider: args.provider.trim(),
        enabled: args.enabled,
        apiKey: args.apiKey?.trim(),
      },
    );
    const parsed = parseRuntimeSpeechToTextConfigPayload(result.type, result.payload);
    if (!parsed) {
      return {
        ok: false,
        output: "",
        enabled: args.enabled,
        error: result.error ?? "Unexpected speech-to-text result",
      };
    }
    if (parsed.ok) {
      const updatedAt = new Date().toISOString();
      await ctx.runMutation(internal.instances.setSpeechToTextStateByOpenclawId, {
        openclawId: instanceId,
        provider: parsed.data.provider ?? args.provider.trim(),
        enabled: parsed.data.enabled === true,
        updatedAt,
      });
    }
    return {
      ok: parsed.ok,
      output: parsed.data.output,
      provider: parsed.data.provider,
      enabled: parsed.data.enabled === true,
      error: parsed.error,
    };
  },
});
