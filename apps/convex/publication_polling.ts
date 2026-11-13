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
      // The Publisher carrying the channel the post went to (ADR-075); the channel itself is needed by a service
      // whose post id alone does not locate it (a GitHub commit).
      const found = channelOf(await projectPublishers(ctx, publication.instanceId), publication.target);
      const apiKey = found?.publisher.apiKey;
      if (!found || !apiKey) continue;
      const { publisher, channel } = found;
      due.push({
        ...(channel.channelId ? { target: { channelId: channel.channelId, ...(channel.settings ? { settings: channel.settings } : {}) } } : {}),
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
