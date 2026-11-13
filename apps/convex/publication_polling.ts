import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { channelOf, projectPublishers } from "./project_publishers.js";

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
      const publishers = await projectPublishers(ctx, publication.instanceId);
      const context = publication.attemptContext;
      const found = channelOf(publishers, publication.target);
      // A reused channel key must not route an older Publication through a replacement Publisher.
      const publisher = context
        ? publishers.find((p) => p.adapter === context.adapter && p.url === context.url)
        : found?.publisher;
      const apiKey = publisher?.apiKey;
      if (!publisher || !apiKey) continue;
      const channel = context ?? found?.channel;
      due.push({
        ...(channel?.channelId ? { target: { channelId: channel.channelId, ...(channel.settings ? { settings: channel.settings } : {}) } } : {}),
        publicationId: publication._id,
        externalId: publication.externalId,
        scheduledAt: publication.scheduledAt,
        linkOnly: publication.status === "published",
        connection: { adapter: publisher.adapter, url: publisher.url, apiKey },
      });
    }
    return due;
  },
});
