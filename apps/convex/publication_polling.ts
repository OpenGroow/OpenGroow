import type { Id } from "./_generated/dataModel.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { pluginFor } from "./publisher/registry.js";

/** How long after publishing the link of a post is looked for (the service posts it asynchronously). */
const LINK_WINDOW_MS = 60 * 60_000;

/**
 * Scheduled Publications whose date has come, and recently published ones that
 * still have no link (an immediate publish is recorded as soon as the service
 * accepts the post, before it has a public URL), with what the adapter needs
 * to ask for their status.
 */
export const dueScheduled = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const scheduled = await ctx.db
      .query("publications")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();
    const recent = await ctx.db
      .query("publications")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .order("desc")
      .take(50);
    const awaitingLink = recent.filter((p) => p.externalUrl === undefined && args.now - p.updatedAt < LINK_WINDOW_MS);
    const due = [];
    for (const publication of [...scheduled, ...awaitingLink]) {
      if (publication.externalId === undefined) continue;
      if (publication.status === "scheduled" && publication.scheduledAt !== undefined && publication.scheduledAt > args.now) continue;
      const publisher = await ctx.db
        .query("publishers")
        .withIndex("by_instance", (q) => q.eq("instanceId", publication.instanceId))
        .unique();
      if (!publisher?.apiKey) continue;
      due.push({
        publicationId: publication._id,
        externalId: publication.externalId,
        scheduledAt: publication.scheduledAt,
        linkOnly: publication.status === "published",
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
 * A published Publication without a link only gets its link filled in.
 */
export const pollScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Array<{
      publicationId: Id<"publications">;
      externalId: string;
      scheduledAt?: number;
      /** Already published: only its link is missing. */
      linkOnly: boolean;
      connection: { adapter: string; url: string; apiKey: string };
    }> = await ctx.runQuery(internal.publication_polling.dueScheduled, { now: Date.now() });
    for (const item of due) {
      const result = await pluginFor(item.connection.adapter).getStatus(item.connection, item.externalId, item.scheduledAt);
      if (!result.ok) continue;
      const { post } = result;
      if (item.linkOnly) {
        if (post.status === "published" && post.externalUrl) {
          await ctx.runMutation(internal.publications.finish, {
            publicationId: item.publicationId,
            status: "published",
            externalUrl: post.externalUrl,
          });
        }
        continue;
      }
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
