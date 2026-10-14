import { internalMutation, internalQuery, query } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
  RUNTIME_HEALTH_RESULT,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  buildRuntimeResultEventId,
  parseRuntimeResult,
  type ValidatedRuntimeResultPayload,
} from "@opengroow/protocol";
import { parseRuntimeAiConfigPayload } from "./runtime_commands_node_parsers.js";

const knownTypes: Set<string> = new Set([
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
  RUNTIME_HEALTH_RESULT,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
]);

const eventValidator = v.object({
  id: v.string(),
  type: v.string(),
  payload: v.optional(v.any()),
  ts: v.number(),
});

export type RuntimeEventValidation =
  // Not a `runtime.*.result` event: the codec doesn't apply, payload passes
  // through unvalidated (this branch's payload type is intentionally
  // `unknown`, not `ValidatedRuntimeResultPayload`).
  | { ok: true; payload: unknown }
  | { ok: true; payload: ValidatedRuntimeResultPayload }
  | { ok: false; error: string };

/** Validate Runtime result payloads before any Convex mapping or persistence. */
export function validateRuntimeEventPayload(
  type: string,
  payload: unknown,
): RuntimeEventValidation {
  if (!type.startsWith("runtime.") || !type.endsWith(".result")) {
    return { ok: true, payload };
  }
  try {
    return { ok: true, payload: parseRuntimeResult(type, payload) };
  } catch {
    return { ok: false, error: "Invalid Runtime result payload" };
  }
}

export const store = internalMutation({
  args: {
    instanceId: v.string(),
    event: eventValidator,
  },
  handler: async (ctx, args) => {
    const validation = validateRuntimeEventPayload(args.event.type, args.event.payload);
    if (!validation.ok) return { status: 400, ok: false, error: validation.error };

    const existing = await ctx.db
      .query("events")
      .withIndex("by_instance_event", (q) =>
        q.eq("instanceId", args.instanceId).eq("eventId", args.event.id),
      )
      .unique();
    if (existing) {
      return { status: 200, ok: true, duplicate: true };
    }
    await ctx.db.insert("events", {
      instanceId: args.instanceId,
      eventId: args.event.id,
      type: args.event.type,
      payload: validation.payload ?? null,
      ts: args.event.ts,
      createdAt: Date.now(),
    });

    if (args.event.type.startsWith("runtime.") && args.event.type.endsWith(".result")) {
      const commandIdPrefix = "runtime-result:";
      if (args.event.id.startsWith(commandIdPrefix)) {
        const commandId = ctx.db.normalizeId(
          "commands",
          args.event.id.slice(commandIdPrefix.length),
        );
        if (commandId !== null) {
          const command = await ctx.db.get(commandId);
          if (command?.instanceId === args.instanceId) {
            await ctx.scheduler.runAfter(0, internal.events_node.signalWaitingAction, {
              instanceId: args.instanceId,
              commandId,
              type: args.event.type,
              payload: validation.payload ?? null,
              ts: args.event.ts,
            });
          }
        }
      }
    }

    const aiConfigResult = parseRuntimeAiConfigPayload(args.event.type, args.event.payload);
    if (aiConfigResult?.ok && aiConfigResult.data.provider && aiConfigResult.data.model) {
      await ctx.runMutation(internal.instances.upsertProviderByOpenclawId, {
        openclawId: args.instanceId,
        kind: "apikey",
        provider: aiConfigResult.data.provider,
        model: aiConfigResult.data.model,
        baseUrl: aiConfigResult.data.baseUrl,
        updatedAt: new Date().toISOString(),
      });
    }

    return { status: 201, ok: true };
  },
});

export const storeCommandResult = internalMutation({
  args: {
    instanceId: v.string(),
    commandId: v.id("commands"),
    type: v.string(),
    payload: v.any(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("commandResults")
      .withIndex("by_instance_and_command", (q) =>
        q.eq("instanceId", args.instanceId).eq("commandId", args.commandId),
      )
      .unique();
    if (existing) {
      return { status: 200, ok: true, duplicate: true };
    }
    await ctx.db.insert("commandResults", {
      ...args,
      createdAt: Date.now(),
    });
    return { status: 201, ok: true };
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    instanceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    const instanceId = args.instanceId;
    const queryBuilder = instanceId
      ? ctx.db
          .query("events")
          .withIndex("by_instance_created", (q) =>
            q.eq("instanceId", instanceId),
          )
      : ctx.db.query("events").withIndex("by_created_at");
    const events = await queryBuilder.order("desc").take(limit);
    return { events };
  },
});

export const getRuntimeCommandResult = query({
  args: {
    instanceId: v.string(),
    commandId: v.id("commands"),
  },
  handler: async (ctx, args) => {
    const eventId = buildRuntimeResultEventId(args.commandId);
    const event = await ctx.db
      .query("events")
      .withIndex("by_instance_event", (q) =>
        q.eq("instanceId", args.instanceId).eq("eventId", eventId),
      )
      .unique();
    if (!event) {
      return { status: 404, found: false };
    }

    const isKnownType = knownTypes.has(event.type);
    return {
      status: 200,
      found: true,
      type: event.type,
      knownType: isKnownType,
      payload: event.payload,
      ts: event.ts,
    };
  },
});

export const getCommandResultFast = internalQuery({
  args: {
    instanceId: v.string(),
    commandId: v.id("commands"),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("commandResults")
      .withIndex("by_instance_and_command", (q) =>
        q.eq("instanceId", args.instanceId).eq("commandId", args.commandId),
      )
      .unique();
    if (!result) {
      const command = await ctx.db.get(args.commandId);
      if (command?.status === "failed") {
        return { status: 500, found: false, error: "Command dispatch failed" };
      }
      return { status: 404, found: false };
    }
    const isKnownType = knownTypes.has(result.type);
    return {
      status: 200,
      found: true,
      type: result.type,
      knownType: isKnownType,
      payload: result.payload,
      ts: result.ts,
    };
  },
});
