import type { Id } from "./_generated/dataModel.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { pluginFor } from "./publisher/registry.js";

/** Scheduled Publications whose date has come, with what the adapter needs to ask for their status. */
export const dueScheduled = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const scheduled = await ctx.db
      .query("publications")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();
    const due = [];
    for (const publication of scheduled) {
      if (publication.externalId === undefined) continue;
      if (publication.scheduledAt !== undefined && publication.scheduledAt > args.now) continue;
      const publisher = await ctx.db
        .query("publishers")
        .withIndex("by_instance", (q) => q.eq("instanceId", publication.instanceId))
        .unique();
      if (!publisher?.apiKey) continue;
      due.push({
        publicationId: publication._id,
        externalId: publication.externalId,
        scheduledAt: publication.scheduledAt,
        connection: { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey },
      });
    }
    return due;
  },
});

/**
 * Polls the adapter for every scheduled Publication that is due (no webhook,
 * like External Job polling): `published` and `failed` are recorded, anything
 * else (still queued, service unreachable) is simply asked again next tick.
 */
export const pollScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Array<{
      publicationId: Id<"publications">;
      externalId: string;
      scheduledAt?: number;
      connection: { adapter: string; url: string; apiKey: string };
    }> = await ctx.runQuery(internal.publication_polling.dueScheduled, { now: Date.now() });
    for (const item of due) {
      const result = await pluginFor(item.connection.adapter).getStatus(item.connection, item.externalId, item.scheduledAt);
      if (!result.ok) continue;
      const { post } = result;
      if (post.status === "published") {
        await ctx.runMutation(internal.publications.finish, {
          publicationId: item.publicationId,
          status: "published",
          ...(post.externalUrl ? { externalUrl: post.externalUrl } : {}),
        });
      } else if (post.status === "failed") {
        await ctx.runMutation(internal.publications.finish, {
          publicationId: item.publicationId,
          status: "failed",
          error: post.error ?? "The Publisher could not publish the post",
        });
      }
    }
  },
});
