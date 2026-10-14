"use node";

import { internalAction, type ActionCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { HmacSigner } from "@opengroow/hmac";
import { env } from "./env";
import type { Id, Doc } from "./_generated/dataModel.js";
import { byCreationOrder, MAX_COALESCE_BATCH } from "./command_batching.js";
import { computeBackoffMs, fetchWithTimeout, isAbortError } from "./command_dispatch_utils.js";

async function scheduleNextQueued(ctx: ActionCtx, instanceId: string): Promise<void> {
  const queued: Doc<"commands">[] = await ctx.runQuery(
    internal.commands.listQueuedByInstance,
    { instanceId },
  );
  const next = queued[0];
  if (next) {
    await ctx.scheduler.runAfter(0, internal.commands_node.dispatch, {
      commandId: next._id,
    });
  }
}

export const dispatch = internalAction({
  args: {
    commandId: v.id("commands"),
    // Set by the batch-endpoint fallback below: the Broker answered 404/501
    // for `/broker/commands/batch`, so each command must reach
    // `/broker/commands` individually. Without this the first fallback call
    // would re-coalesce its siblings and replay the very request that failed.
    bypassCoalescing: v.optional(v.boolean()),
    // Interactive dashboard actions surface delivery failures immediately so
    // the user can retry deliberately. Background work keeps the durable
    // retry/backoff behavior by leaving this unset (the default is true).
    retryOnFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const command: Doc<"commands"> | null = await ctx.runQuery(internal.commands.getCommand, {
      commandId: args.commandId,
    });

    if (!command) {
      return { status: 404, error: "Command not found" };
    }

    if (command.deferred) {
      return { status: 200, ok: true, skipped: true, reason: "deferred" };
    }

    let candidateIds: Id<"commands">[] = [command._id];
    if (!args.bypassCoalescing) {
      const siblings: Doc<"commands">[] = await ctx.runQuery(
        internal.commands.listQueuedByInstance,
        { instanceId: command.instanceId },
      );
      const others: Doc<"commands">[] = siblings
        .filter((s: Doc<"commands">) => s._id !== command!._id)
        .sort(byCreationOrder)
        .slice(0, MAX_COALESCE_BATCH - 1);
      candidateIds = [command!, ...others].sort(byCreationOrder).map((c) => c._id);
    }

    // Claiming happens in one transaction, this command included: an enqueue
    // running concurrently must not be able to fold a command this action is
    // about to forward into a second batch and send it twice.
    const claimedIds: Id<"commands">[] = await ctx.runMutation(
      internal.commands.claimForBatch,
      { commandIds: candidateIds },
    );
    if (!claimedIds.includes(command._id)) {
      return { status: 200, ok: true, skipped: true, reason: "claimed by another batch" };
    }

    if (claimedIds.length > 1) {
      await ctx.scheduler.runAfter(0, internal.commands_batch_node.dispatchBatch, {
        instanceId: command.instanceId,
        commandIds: claimedIds,
      });
      return { status: 202, ok: true, coalesced: claimedIds.length };
    }

    const now = Date.now();
    const attempts = (command.attempts ?? 0) + 1;

    const brokerUrl = env.BROKER_URL;
    const fetchTimeoutMs = env.BROKER_FETCH_TIMEOUT_MS;

    const signer = new HmacSigner({
      keyId: env.BROKER_KEY_ID,
      secret: env.BROKER_SECRET,
      prefix: "broker",
    });

    const commandPayload = {
      instanceId: command.instanceId,
      command: {
        id: command._id,
        type: command.type,
        payload: command.payload!,
        ts: now,
      },
    };
    const rawBody = JSON.stringify(commandPayload);
    const hmacHeaders = signer.sign("POST", "/broker/commands", rawBody);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        new URL("/broker/commands", brokerUrl).toString(),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...hmacHeaders,
          },
          body: rawBody,
        },
        fetchTimeoutMs,
      );
    } catch (error) {
      console.warn(
        `[commands_node.dispatch] broker request failed commandId=${command._id} instanceId=${command.instanceId} type=${command.type} url=${brokerUrl}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      await scheduleNextQueued(ctx, command.instanceId);
      if (args.retryOnFailure === false) {
        await ctx.runMutation(internal.commands.updateCommand, {
          commandId: command._id,
          attempts,
          lastAttemptAt: now,
          status: "failed",
        });
        return {
          status: 502,
          error: isAbortError(error)
            ? "Broker request timed out"
            : "Broker unreachable",
        };
      }
      await ctx.runMutation(internal.commands.updateCommand, {
        commandId: command._id,
        attempts,
        lastAttemptAt: now,
        status: "queued",
      });
      // Release the claim taken above, or the retry below skips the command
      // at the `deferred` check and it stays queued forever.
      await ctx.runMutation(internal.commands.clearDeferred, {
        commandIds: [command._id],
      });
      const delayMs = computeBackoffMs(attempts);
      await ctx.scheduler.runAfter(delayMs, internal.commands_node.dispatch, {
        commandId: command._id,
      });
      return {
        status: 502,
        error: isAbortError(error)
          ? "Broker request timed out"
          : "Broker unreachable",
        retryInMs: delayMs,
      };
    }

    await ctx.runMutation(internal.commands.updateCommand, {
      commandId: command._id,
      attempts,
      lastAttemptAt: now,
      status: command.status,
    });

    if (response.status === 200) {
      await ctx.runMutation(internal.commands.updateCommand, {
        commandId: command._id,
        attempts,
        lastAttemptAt: now,
        status: "sent",
      });
      await scheduleNextQueued(ctx, command.instanceId);
      return { status: 200, ok: true };
    }

    if (response.status === 409) {
      await scheduleNextQueued(ctx, command.instanceId);
      if (args.retryOnFailure === false) {
        await ctx.runMutation(internal.commands.updateCommand, {
          commandId: command._id,
          attempts,
          lastAttemptAt: now,
          status: "failed",
        });
        return { status: 409, error: "OpenClaw offline" };
      }
      await ctx.runMutation(internal.commands.updateCommand, {
        commandId: command._id,
        attempts,
        lastAttemptAt: now,
        status: "queued",
      });
      await ctx.runMutation(internal.commands.clearDeferred, {
        commandIds: [command._id],
      });
      const delayMs = computeBackoffMs(attempts);
      await ctx.scheduler.runAfter(delayMs, internal.commands_node.dispatch, {
        commandId: command._id,
      });
      return { status: 409, retryInMs: delayMs };
    }

    const responseBody = await response.text();
    console.warn(
      `[commands_node.dispatch] broker rejected commandId=${command._id} instanceId=${command.instanceId} type=${command.type} url=${brokerUrl} status=${response.status} body=${responseBody}`,
    );
    await ctx.runMutation(internal.commands.updateCommand, {
      commandId: command._id,
      attempts,
      lastAttemptAt: now,
      status: "failed",
    });
    await scheduleNextQueued(ctx, command.instanceId);
    return { status: response.status, error: responseBody };
  },
});
