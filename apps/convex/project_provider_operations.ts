"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_OPENCLAW_EXEC,
} from "@opengroow/protocol";
import {
  enqueueInteractiveCommand,
  waitForRuntimeEvent,
} from "./runtime_commands_node";
import {
  parseRuntimeAiConfigPayload,
  parseRuntimeOpenClawExecPayload,
} from "./runtime_commands_node_parsers";

export type ProjectProviderResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  output: string;
  error?: string;
};

export type ProjectDeveloperCommandResult = {
  ok: boolean;
  commandText: string;
  output: string;
  exitCode: number | null;
  error?: string;
};

async function readRuntimeResult(
  ctx: ActionCtx,
  instanceId: string,
  type: string,
  payload: unknown,
  timeoutMs?: number,
): Promise<{ type?: string; payload?: unknown; error?: string }> {
  const dispatch = await enqueueInteractiveCommand(ctx, {
    instanceId,
    type,
    payload,
  });
  if (!dispatch.accepted || !dispatch.commandId) {
    return { error: "Runtime command was not accepted" };
  }
  const result = await waitForRuntimeEvent(ctx, instanceId, dispatch.commandId, timeoutMs);
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

export const configureAiProvider = action({
  args: {
    instanceId: v.string(),
    provider: v.string(),
    apiKey: v.optional(v.string()),
    model: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProjectProviderResult> => {
    const instanceId = args.instanceId.trim();
    const provider = args.provider.trim();
    const model = args.model.trim();
    const payload: Record<string, string> = { provider, model };
    if (args.apiKey?.trim()) payload.apiKey = args.apiKey.trim();
    if (args.baseUrl?.trim()) payload.baseUrl = args.baseUrl.trim();
    const result = await readRuntimeResult(ctx, instanceId, RUNTIME_AI_CONFIG_SET, payload);
    const parsed = parseRuntimeAiConfigPayload(result.type, result.payload);
    if (!parsed) {
      return { ok: false, output: "", error: result.error ?? "Unexpected AI provider result" };
    }
    if (parsed.ok) {
      await ctx.runMutation(internal.instances.upsertProviderByOpenclawId, {
        openclawId: instanceId,
        kind: "apikey",
        provider: parsed.data.provider ?? provider,
        model: parsed.data.model ?? model,
        baseUrl: parsed.data.baseUrl,
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      ok: parsed.ok,
      provider: parsed.data.provider ?? provider,
      model: parsed.data.model ?? model,
      output: parsed.data.output,
      error: parsed.error,
    };
  },
});

export const executeDeveloperCommand = action({
  args: {
    instanceId: v.string(),
    commandText: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProjectDeveloperCommandResult> => {
    const instanceId = args.instanceId.trim();
    const commandText = args.commandText.trim();
    if (!commandText) {
      return { ok: false, commandText, output: "", exitCode: null, error: "OpenClaw command is required" };
    }
    const result = await readRuntimeResult(
      ctx,
      instanceId,
      RUNTIME_OPENCLAW_EXEC,
      { commandText, timeoutMs: args.timeoutMs },
      args.timeoutMs,
    );
    const parsed = parseRuntimeOpenClawExecPayload(result.type, result.payload);
    if (!parsed) {
      return {
        ok: false,
        commandText,
        output: "",
        exitCode: null,
        error: result.error ?? "Unexpected OpenClaw command result",
      };
    }
    return {
      ok: parsed.ok,
      commandText: parsed.data.commandText ?? commandText,
      output: parsed.data.output,
      exitCode: parsed.data.exitCode ?? null,
      error: parsed.error,
    };
  },
});
