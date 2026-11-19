import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import { ownerIdFor } from "./instance_ownership.js";
import { postFace } from "./analytics.js";

// The thumbnail of a published article, read from its public page and cached (the Publishable has none).

/** A page that had no image is asked again after this. */
export const RETRY_NO_IMAGE_MS = 7 * 24 * 60 * 60_000;
/** The most pages fetched by one call. */
export const MAX_FETCHES = 20;

/** The Project's published Publications with a public page whose thumbnail is still to look for. */
export const pending = internalQuery({
  args: { instanceId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("desc")
      .take(200);
    const out: Array<{ publicationId: (typeof publications)[number]["_id"]; url: string }> = [];
    for (const publication of publications) {
      if (!publication.externalUrl || out.length >= MAX_FETCHES) continue;
      const mission = await ctx.db.get(publication.missionId);
      if (!mission) continue;
      const face = postFace(mission, publication.target.split(":")[0]);
      if (face.thumbnailUrl || face.videoUrl) continue;
      const cached = await ctx.db
        .query("pageThumbnails")
        .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
        .first();
      if (cached && (cached.url !== null || args.now - cached.fetchedAt < RETRY_NO_IMAGE_MS)) continue;
      out.push({ publicationId: publication._id, url: publication.externalUrl });
    }
    return out;
  },
});

/** Keeps what a page gave (null: it has no image), replacing an older entry. */
export const store = internalMutation({
  args: { entries: v.array(v.object({ publicationId: v.id("publications"), url: v.union(v.string(), v.null()) })) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const { publicationId, url } of args.entries) {
      const cached = await ctx.db
        .query("pageThumbnails")
        .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
        .first();
      if (cached) await ctx.db.patch(cached._id, { url, fetchedAt: now });
      else await ctx.db.insert("pageThumbnails", { publicationId, url, fetchedAt: now });
    }
  },
});
