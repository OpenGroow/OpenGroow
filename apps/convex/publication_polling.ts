import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";

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
      // The channel the post went to: a service whose post id alone does not locate it (a GitHub commit) needs it.
      const context = publication.attemptContext;
      // Use the current key only for the original service, never a replacement connection.
      if (context && (context.adapter !== publisher.adapter || context.url !== publisher.url)) continue;
      const channel = context ?? publisher.targets.find((t) => t.target === publication.target);
      due.push({
        ...(channel?.channelId ? { target: { channelId: channel.channelId, ...(channel.settings ? { settings: channel.settings } : {}) } } : {}),
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
