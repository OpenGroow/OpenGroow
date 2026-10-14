import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { commandStatusV } from "./validators.js";
import type { DatabaseReader } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import {
  COMMAND_COALESCE_WINDOW_MS,
  MAX_COALESCE_BATCH,
} from "./command_batching.js";

export { MAX_COALESCE_BATCH } from "./command_batching.js";

const commandPayload = v.object({
  instanceId: v.string(),
  type: v.string(),
  payload: v.optional(v.any())
});

type CommandPayload = {
  instanceId: string;
  type: string;
  payload?: unknown;
};

async function insertQueuedCommand(ctx: MutationCtx, args: CommandPayload) {
  const commandId = await ctx.db.insert("commands", {
    instanceId: args.instanceId,
    type: args.type,
    payload: args.payload ?? null,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
    deferred: false,
  });
  return { status: 202, accepted: true, commandId } as const;
}

/**
 * The queued commands that are still dispatchable (not already folded into a
 * pending batch), oldest first, bounded to `MAX_COALESCE_BATCH`.
 */
function queryDispatchableQueued(ctx: { db: DatabaseReader }, instanceId: string) {
  return ctx.db
    .query("commands")
    .withIndex("by_instance_and_status_and_deferred", (q) =>
      q.eq("instanceId", instanceId).eq("status", "queued").eq("deferred", false),
    )
    .take(MAX_COALESCE_BATCH);
}

/**
 * Persist a Runtime command and schedule its delivery. Shared by the public
 * `enqueue` mutation and by mutations that queue a command in their own
 * transaction.
 */
export async function enqueueCommand(ctx: MutationCtx, args: CommandPayload) {
  const [dispatchableHead] = await queryDispatchableQueued(ctx, args.instanceId);
  const result = await insertQueuedCommand(ctx, args);

  // Every enqueue schedules a liveness signal for the dispatchable queue
  // head. Duplicate calls for the same head are harmless because dispatch
  // claims atomically, while targeting one head avoids competing overflow
  // drainers. Legacy queued rows without `deferred` are intentionally not
  // replayed, but can no longer strand new work behind them.
  await ctx.scheduler.runAfter(
    COMMAND_COALESCE_WINDOW_MS,
    internal.commands_node.dispatch,
    { commandId: dispatchableHead?._id ?? result.commandId },
  );

  return result;
}

export const enqueue = mutation({
  args: commandPayload,
  handler: enqueueCommand,
});

/** Persist a dashboard command without scheduling background delivery. */
export const enqueueInteractive = internalMutation({
  args: commandPayload,
  handler: insertQueuedCommand,
});

export const enqueueBatch = internalMutation({
  args: {
    commands: v.array(commandPayload),
  },
  handler: async (ctx, args) => {
    const instanceId = args.commands[0]?.instanceId;
    if (args.commands.some((command) => command.instanceId !== instanceId)) {
      throw new Error("Batch commands must belong to one instance");
    }
    const createdAt = Date.now();
    const commandIds = [];

    for (const cmd of args.commands) {
      const commandId = await ctx.db.insert("commands", {
        instanceId: cmd.instanceId,
        type: cmd.type,
        payload: cmd.payload ?? null,
        status: "queued",
        attempts: 0,
        createdAt,
        deferred: true,
      });
      commandIds.push(commandId);
    }

    if (commandIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.commands_batch_node.dispatchBatch, {
        instanceId: instanceId!,
        commandIds,
      });
    }

    return { status: 202, accepted: true, commandIds };
  }
});

export const getCommand = internalQuery({
  args: { commandId: v.id("commands") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.commandId);
  }
});

export const getQueuedBatch = internalQuery({
  args: { commandIds: v.array(v.id("commands")) },
  handler: async (ctx, args) => {
    const commands = [];
    for (const commandId of args.commandIds) {
      const command = await ctx.db.get(commandId);
      if (command?.status === "queued") {
        commands.push(command);
      }
    }
    return commands;
  },
});

export const listQueuedByInstance = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    return queryDispatchableQueued(ctx, args.instanceId);
  },
});

export const clearDeferred = internalMutation({
  args: { commandIds: v.array(v.id("commands")) },
  handler: async (ctx, args) => {
    for (const commandId of args.commandIds) {
      const command = await ctx.db.get(commandId);
      if (command?.deferred) {
        await ctx.db.patch(commandId, { deferred: false });
      }
    }
  }
});

/**
 * Atomically claim commands for one scheduled batch, in a single
 * transaction, and return the ids actually claimed — in the order they were
 * offered. A command already claimed by another batch (or no longer queued)
 * is left out rather than silently forwarded twice: `dispatch` runs as an
 * action, so between listing its siblings and claiming them another enqueue
 * can have taken ownership of some of them.
 */
export const claimForBatch = internalMutation({
  args: { commandIds: v.array(v.id("commands")) },
  handler: async (ctx, args) => {
    const claimed: Id<"commands">[] = [];
    for (const commandId of args.commandIds) {
      const command = await ctx.db.get(commandId);
      if (command && command.status === "queued" && !command.deferred) {
        await ctx.db.patch(commandId, { deferred: true });
        claimed.push(commandId);
      }
    }
    return claimed;
  },
});

export const updateCommand = internalMutation({
  args: {
    commandId: v.id("commands"),
    attempts: v.number(),
    lastAttemptAt: v.number(),
    status: commandStatusV
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commandId, {
      attempts: args.attempts,
      lastAttemptAt: args.lastAttemptAt,
      status: args.status
    });
    return { commandId: args.commandId };
  }
});

export const updateBatch = internalMutation({
  args: {
    updates: v.array(v.object({
      commandId: v.id("commands"),
      attempts: v.number(),
      lastAttemptAt: v.number(),
      status: commandStatusV,
      releaseDeferred: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.commandId, {
        attempts: update.attempts,
        lastAttemptAt: update.lastAttemptAt,
        status: update.status,
        ...(update.releaseDeferred ? { deferred: false } : {}),
      });
    }
  },
});

export const ack = internalMutation({
  args: {
    commandId: v.id("commands"),
    instanceId: v.string()
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command) {
      return null;
    }
    if (command.instanceId !== args.instanceId) {
      return null;
    }
    // Broker ack is only a delivery receipt. Keeping it out of the `commands`
    // document avoids a hot-document race with updateCommand/status transitions.
    return {
      commandId: command._id,
      instanceId: command.instanceId,
      ackedAt: Date.now()
    };
  }
});
