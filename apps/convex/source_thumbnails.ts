import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";

// A Source's thumbnail is the `og:image` of its public page (Instagram, TikTok).
// The CDN URLs those pages expose are signed and expire within days, so the
// image itself is copied into Convex storage instead of linking to it.
// Everything here is best effort: no thumbnail simply leaves the family glyph.

/** Pages whose `og:image` is read. Anything else is never requested. */
const PAGE_HOSTS = /(^|\.)(instagram\.com|tiktok\.com)$/;
/** Hosts the images themselves may come from. */
const IMAGE_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn[a-z-]*\.com)$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
// Instagram and TikTok serve their link-preview metadata to this crawler UA.
const CRAWLER_USER_AGENT = "facebookexternalhit/1.1";
/** At most this many Sources are scheduled by one `request` call. */
export const MAX_REQUESTED = 20;

function isHttpsOn(url: string, hosts: RegExp): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.test(parsed.hostname);
  } catch {
    return false;
  }
}

export const isThumbnailPage = (url: string): boolean => isHttpsOn(url, PAGE_HOSTS);
const isImageUrl = (url: string): boolean => isHttpsOn(url, IMAGE_HOSTS);

// What TikTok serves instead of a cover when it has none to show (a private or
// removed video): a generic fallback or its own logo. They are not a thumbnail.
const PLACEHOLDER_IMAGE = /cover-fallback|\/static\/images\/|tiktok-logo|poster-square/i;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The `og:image` URL of an HTML page, when it names an allowed image host. */
export function ogImageOf(html: string): string | undefined {
  for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    const url = decodeEntities(content);
    if (isImageUrl(url) && !PLACEHOLDER_IMAGE.test(url)) return url;
  }
  return undefined;
}

export const getForFetch = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.thumbnailStorageId !== undefined) return null;
    return { origin: source.origin };
  },
});

export const save = internalMutation({
  args: { sourceId: v.id("sources"), storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) {
      if (args.storageId) await ctx.storage.delete(args.storageId);
      return;
    }
    // `thumbnailTriedAt` stops a Source without a usable image from being asked again.
    await ctx.db.patch(source._id, {
      thumbnailTriedAt: Date.now(),
      ...(args.storageId ? { thumbnailStorageId: args.storageId } : {}),
    });
  },
});

export const fetchThumbnail = internalAction({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source: { origin: string } | null = await ctx.runQuery(internal.source_thumbnails.getForFetch, { sourceId: args.sourceId });
    if (!source || !isThumbnailPage(source.origin)) return;
    let storageId: Id<"_storage"> | undefined;
    try {
      const page = await fetch(source.origin, { headers: { "user-agent": CRAWLER_USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const imageUrl = page.ok ? ogImageOf(await page.text()) : undefined;
      if (imageUrl) {
        const image = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const type = image.headers.get("content-type") ?? "";
        if (image.ok && type.startsWith("image/")) {
          const bytes = await image.arrayBuffer();
          if (bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES) storageId = await ctx.storage.store(new Blob([bytes], { type }));
        }
      }
    } catch {
      // Network failure, timeout or a blocked request: no thumbnail.
    }
    await ctx.runMutation(internal.source_thumbnails.save, { sourceId: args.sourceId, ...(storageId ? { storageId } : {}) });
  },
});

/** Called by the Ready tab with the Sources on screen: schedules the fetch for
 * those that never had one (backfill and Sources still waiting for theirs). */
export const request = mutation({
  args: { instanceId: v.string(), sourceIds: v.array(v.id("sources")) },
  handler: async (ctx, args) => {
    const ownerIds = await ownerIdsFor(ctx, args.instanceId);
    if (ownerIds === null) return;
    let scheduled = 0;
    for (const sourceId of args.sourceIds) {
      if (scheduled >= MAX_REQUESTED) break;
      const source = await ctx.db.get(sourceId);
      if (!source || source.instanceId !== args.instanceId) continue;
      await requireOwnedRow(ctx, source);
      if (source.thumbnailStorageId !== undefined || source.thumbnailTriedAt !== undefined || !isThumbnailPage(source.origin)) continue;
      // Mark it now so two renders do not schedule it twice.
      await ctx.db.patch(source._id, { thumbnailTriedAt: Date.now() });
      await ctx.scheduler.runAfter(scheduled * 500, internal.source_thumbnails.fetchThumbnail, { sourceId });
      scheduled += 1;
    }
  },
});
