"use node";

import { internalAction, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { HmacSigner } from "@opengroow/hmac";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import { env } from "./env.js";
import { computeBackoffMs, fetchWithTimeout } from "./command_dispatch_utils.js";

type BatchCommand = Doc<"commands">;

async function updateCommands(
  ctx: ActionCtx,
  commands: BatchCommand[],
  now: number,
  statusFor: (command: BatchCommand) => "queued" | "sent" | "failed",
  releaseFor: (command: BatchCommand) => boolean = () => false,
): Promise<void> {
  await ctx.runMutation(internal.commands.updateBatch, {
    updates: commands.map((command) => ({
      commandId: command._id,
      attempts: (command.attempts ?? 0) + 1,
      lastAttemptAt: now,
      status: statusFor(command),
      releaseDeferred: releaseFor(command),
    })),
  });
}

async function scheduleRetries(
  ctx: ActionCtx,
  commands: BatchCommand[],
  bypassCoalescing = false,
): Promise<void> {
  for (const command of commands) {
    await ctx.scheduler.runAfter(
      computeBackoffMs((command.attempts ?? 0) + 1),
      internal.commands_node.dispatch,
      {
        commandId: command._id,
        ...(bypassCoalescing ? { bypassCoalescing: true } : {}),
      },
    );
  }
}

/**
 * Continue draining a bounded queue after this batch. Call while the current
 * commands are still deferred so only untouched overflow can be selected;
 * released retries keep their own backoff schedule.
 */
async function scheduleOverflow(ctx: ActionCtx, instanceId: string): Promise<void> {
  const queued: BatchCommand[] = await ctx.runQuery(internal.commands.listQueuedByInstance, {
    instanceId,
  });
  const next = queued[0];
  if (next) {
    await ctx.scheduler.runAfter(0, internal.commands_node.dispatch, {
      commandId: next._id,
    });
  }
}

async function dispatchBatchHandler(
  ctx: ActionCtx,
  args: { instanceId: string; commandIds: BatchCommand["_id"][] },
): Promise<Record<string, unknown>> {
    const commands: BatchCommand[] = await ctx.runQuery(internal.commands.getQueuedBatch, {
      commandIds: args.commandIds,
    });
    if (commands.length === 0) {
      return { status: 200, ok: true, dispatched: 0 };
    }
    if (commands.some((command) => command.instanceId !== args.instanceId)) {
      await updateCommands(ctx, commands, Date.now(), () => "queued", () => true);
      return { status: 400, error: "Batch commands must belong to one instance" };
    }

    const now = Date.now();
    const brokerUrl = env.BROKER_URL;
    const signer = new HmacSigner({
      keyId: env.BROKER_KEY_ID,
      secret: env.BROKER_SECRET,
      prefix: "broker",
    });
    const rawBody = JSON.stringify({
      instanceId: args.instanceId,
      commands: commands.map((command) => ({
        id: command._id,
        type: command.type,
        payload: command.payload,
        ts: now,
      })),
    });
    const hmacHeaders = signer.sign("POST", "/broker/commands/batch", rawBody);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        new URL("/broker/commands/batch", brokerUrl).toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json", ...hmacHeaders },
          body: rawBody,
        },
        env.BROKER_FETCH_TIMEOUT_MS,
      );
    } catch (error) {
      console.warn(
        `[commands_batch_node.dispatchBatch] broker request failed instanceId=${args.instanceId} count=${commands.length} url=${brokerUrl}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      await scheduleOverflow(ctx, args.instanceId);
      await updateCommands(ctx, commands, now, () => "queued", () => true);
      await scheduleRetries(ctx, commands);
      return { status: 502, error: "Broker unreachable" };
    }

    if (response.status === 200) {
      await updateCommands(ctx, commands, now, () => "sent");
      const overflowDispatched = await drainOverflowAfterSuccess(ctx, args.instanceId);
      return {
        status: 200,
        ok: true,
        dispatched: commands.length + overflowDispatched,
      };
    }

    if (response.status === 207) {
      let parsed: { failed?: unknown } | undefined;
      try {
        parsed = JSON.parse(await response.text()) as { failed?: unknown };
      } catch {
        // An invalid multi-status response cannot prove any command was sent.
      }
      const knownIds = new Set(commands.map((command) => command._id as string));
      const reported = parsed?.failed;
      const validReport = Array.isArray(reported)
        && reported.length > 0
        && reported.every((id): id is string => typeof id === "string" && knownIds.has(id));
      const failedSet = new Set<string>(
        validReport ? reported : commands.map((command) => command._id as string),
      );
      const failed = commands.filter((command) => failedSet.has(command._id));
      await scheduleOverflow(ctx, args.instanceId);
      await updateCommands(
        ctx,
        commands,
        now,
        (command) => failedSet.has(command._id) ? "queued" : "sent",
        (command) => failedSet.has(command._id),
      );
      await scheduleRetries(ctx, failed);
      return { status: 207, partial: true, failedCount: failed.length };
    }

    if (response.status === 409) {
      await scheduleOverflow(ctx, args.instanceId);
      await updateCommands(ctx, commands, now, () => "queued", () => true);
      await scheduleRetries(ctx, commands);
      return { status: 409, retryInMs: computeBackoffMs(1) };
    }

    const responseBody = await response.text();
    console.warn(
      `[commands_batch_node.dispatchBatch] broker rejected batch instanceId=${args.instanceId} status=${response.status} body=${responseBody}`,
    );
    if (response.status === 404 || response.status === 501) {
      await scheduleOverflow(ctx, args.instanceId);
      await updateCommands(ctx, commands, now, () => "queued", () => true);
      await scheduleRetries(ctx, commands, true);
      return {
        status: response.status,
        error: "Batch endpoint unavailable, falling back to individual dispatch",
      };
    }

    await scheduleOverflow(ctx, args.instanceId);
    await updateCommands(ctx, commands, now, () => "failed");
    return { status: response.status, error: responseBody };
}

async function drainOverflowAfterSuccess(
  ctx: ActionCtx,
  instanceId: string,
): Promise<number> {
  const queued: BatchCommand[] = await ctx.runQuery(internal.commands.listQueuedByInstance, {
    instanceId,
  });
  if (queued.length === 0) return 0;

  const claimedIds: BatchCommand["_id"][] = await ctx.runMutation(
    internal.commands.claimForBatch,
    { commandIds: queued.map((command) => command._id) },
  );
  if (claimedIds.length === 0) return 0;
  if (claimedIds.length === 1) {
    await ctx.runMutation(internal.commands.clearDeferred, { commandIds: claimedIds });
    await ctx.scheduler.runAfter(0, internal.commands_node.dispatch, {
      commandId: claimedIds[0],
    });
    return 0;
  }

  const result = await dispatchBatchHandler(ctx, { instanceId, commandIds: claimedIds });
  return typeof result.dispatched === "number" ? result.dispatched : 0;
}

export const dispatchBatch = internalAction({
  args: {
    instanceId: v.string(),
    commandIds: v.array(v.id("commands")),
  },
  handler: dispatchBatchHandler,
});
