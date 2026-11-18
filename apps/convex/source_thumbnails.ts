import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";
import type { Doc } from "./_generated/dataModel.js";
import { internalAction, internalMutation, internalQuery, mutation, type QueryCtx } from "./_generated/server.js";
import { resolveSource } from "./source_enrichment.js";
import { isHttpsOn } from "./source_platform.js";
import { ownerIdsFor, requireOwnedRow } from "./instance_ownership.js";

// A Source's thumbnail is the image of its public page. Which pages and which
// image hosts are allowed is declared by the Template (`platform.pageHosts`,
// `platform.imageHosts`) and the strategy that finds the image is named by
// `platform.thumbnail` (ADR-077): nothing here knows a platform. The CDN URLs
// those pages expose are signed and expire within days, so the image itself is
// copied into Convex storage instead of linking to it.
// Everything here is best effort: no thumbnail simply leaves the family glyph.

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
// Platforms serve their link-preview metadata to this crawler UA.
const CRAWLER_USER_AGENT = "facebookexternalhit/1.1";
/** At most this many Sources are scheduled by one `request` call. */
export const MAX_REQUESTED = 20;

/** What a Source needs for its thumbnail to be fetched: the declared platform has a strategy and the origin is one of its pages. */
export function thumbnailPlatformOf(platform: SourcePlatformDeclaration | undefined, origin: string): SourcePlatformDeclaration | undefined {
  return platform?.thumbnail === "og-image" && isHttpsOn(origin, platform.pageHosts) ? platform : undefined;
}

// What platforms serve instead of a cover when they have none to show (a
// private or removed video): a generic fallback or their own logo. They are not
// a thumbnail.
const PLACEHOLDER_IMAGE = /cover-fallback|\/static\/images\/|tiktok-logo|poster-square/i;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The `og:image` URL of an HTML page, when it names one of the declared image hosts. */
export function ogImageOf(html: string, imageHosts: readonly string[]): string | undefined {
  for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    const url = decodeEntities(content);
    if (isHttpsOn(url, imageHosts) && !PLACEHOLDER_IMAGE.test(url)) return url;
  }
  return undefined;
}

/** The platform a Source's Template declares for it (none when the Template is gone or no longer declares it). */
async function declaredPlatformOf(ctx: QueryCtx, source: Doc<"sources">): Promise<SourcePlatformDeclaration | undefined> {
  return (await resolveSource(ctx, source.instanceId, source.templateId, source.sourceId))?.declaration.platform;
}

export const getForFetch = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.thumbnailStorageId !== undefined) return null;
    const platform = thumbnailPlatformOf(await declaredPlatformOf(ctx, source), source.origin);
    return platform ? { origin: source.origin, imageHosts: platform.imageHosts ?? [] } : null;
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
    const source: { origin: string; imageHosts: string[] } | null = await ctx.runQuery(internal.source_thumbnails.getForFetch, { sourceId: args.sourceId });
    if (!source) return;
    let storageId: Id<"_storage"> | undefined;
    try {
      const page = await fetch(source.origin, { headers: { "user-agent": CRAWLER_USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const imageUrl = page.ok ? ogImageOf(await page.text(), source.imageHosts) : undefined;
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
      if (source.thumbnailStorageId !== undefined || source.thumbnailTriedAt !== undefined) continue;
      if (!thumbnailPlatformOf(await declaredPlatformOf(ctx, source), source.origin)) continue;
      // Mark it now so two renders do not schedule it twice.
      await ctx.db.patch(source._id, { thumbnailTriedAt: Date.now() });
      await ctx.scheduler.runAfter(scheduled * 500, internal.source_thumbnails.fetchThumbnail, { sourceId });
      scheduled += 1;
    }
  },
});
