"use node";

import type { Id } from "./_generated/dataModel.js";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import { loadPlugin } from "./publisher/load_node.js";

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
      // One Publication whose package is gone or whose plugin throws must not stop the others.
      let result;
      try {
        result = await (await loadPlugin(ctx, item.connection.adapter)).getStatus(item.connection, item.externalId, item.scheduledAt);
      } catch {
        continue;
      }
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
