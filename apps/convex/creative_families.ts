import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { query, type QueryCtx } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";
import { engagementCountsOf } from "./sources_social.js";

// Read side of the Creative Library (ADR-082): a Creative Family is a list the
// user curates, and its `description` states the mechanic its Sources share.
// Every read resolves ownership through the Instance, like `sources.ts`.

/** The most Sources counted per family; beyond it the count is reported capped. */
export const FAMILY_COUNT_CAP = 100;
/** Recent Sources shown with each family. */
export const RECENT_SOURCES = 3;

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

type SourceView = Omit<Doc<"sources">, "raw" | "rawData"> & { thumbnailUrl: string | null };

/** A Source without its large raw capture fields, with a loadable thumbnail URL. */
async function viewOf(ctx: QueryCtx, source: Doc<"sources">): Promise<SourceView> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { raw, rawData, ...rest } = source;
  const thumbnailUrl = source.thumbnailStorageId ? await ctx.storage.getUrl(source.thumbnailStorageId) : null;
  return { ...rest, thumbnailUrl };
}

function familySources(
  ctx: QueryCtx,
  instanceId: string,
  ownerId: string,
  familyId: Id<"creativeFamilies"> | undefined,
) {
  return ctx.db
    .query("sources")
    .withIndex("by_instance_owner_creativeFamily_createdAt", (q) =>
      q.eq("instanceId", instanceId).eq("ownerId", ownerId).eq("creativeFamilyId", familyId),
    )
    .order("desc");
}

function statusOf(family: Doc<"creativeFamilies">): "active" | "archived" {
  return family.status ?? "active";
}

/** A family of the caller's Instance, or null (another Instance's family is "not found"). */
async function ownedFamily(ctx: QueryCtx, instanceId: string, familyId: Id<"creativeFamilies">) {
  const family = await ctx.db.get(familyId);
  return family && family.instanceId === instanceId ? family : null;
}

/** The Project's families with their capped Source count and three recent Sources. */
export const list = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    const families = await ctx.db
      .query("creativeFamilies")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();
    return await Promise.all(
      families.map(async (family) => {
        const sources = await familySources(ctx, args.instanceId, ownerId, family._id).take(FAMILY_COUNT_CAP + 1);
        return {
          _id: family._id,
          slug: family.slug,
          name: family.name,
          description: family.description,
          status: statusOf(family),
          mergedIntoId: family.mergedIntoId,
          sourceCount: Math.min(sources.length, FAMILY_COUNT_CAP),
          sourceCountCapped: sources.length > FAMILY_COUNT_CAP,
          recentSources: await Promise.all(sources.slice(0, RECENT_SOURCES).map((s) => viewOf(ctx, s))),
        };
      }),
    );
  },
});

/** One family, or null for a stranger or a family of another Instance. */
export const get = query({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return null;
    const family = await ownedFamily(ctx, args.instanceId, args.familyId);
    if (!family) return null;
    return {
      _id: family._id,
      slug: family.slug,
      name: family.name,
      description: family.description,
      status: statusOf(family),
      mergedIntoId: family.mergedIntoId,
    };
  },
});

/** A family's Sources, newest first, paginated. */
export const listSources = query({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return EMPTY_PAGE;
    if (!(await ownedFamily(ctx, args.instanceId, args.familyId))) return EMPTY_PAGE;
    const result = await familySources(ctx, args.instanceId, ownerId, args.familyId).paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((s) => viewOf(ctx, s))) };
  },
});

/** The Sources that belong to no family, newest first, paginated. */
export const listUnclassified = query({
  args: { instanceId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return EMPTY_PAGE;
    const result = await familySources(ctx, args.instanceId, ownerId, undefined).paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((s) => viewOf(ctx, s))) };
  },
});

/** The most Sources a family's statistics are computed over. */
export const STATS_SOURCE_CAP = 500;

function medianOf(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A family's statistics, computed at read time (nothing is stored) over its
 * newest Sources, at most STATS_SOURCE_CAP, with a flag when it was cut short.
 * Median and maximum cover only the Sources with views; a missing metric is
 * unknown (`null`), never zero. Null for a stranger or a family of another Instance.
 */
export const stats = query({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return null;
    if (!(await ownedFamily(ctx, args.instanceId, args.familyId))) return null;
    const fetched = await familySources(ctx, args.instanceId, ownerId, args.familyId).take(STATS_SOURCE_CAP + 1);
    const sources = fetched.slice(0, STATS_SOURCE_CAP);
    const views = sources
      .map((s) => engagementCountsOf(s).viewCount)
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);
    return {
      sourceCount: sources.length,
      withViewsCount: views.length,
      medianViews: views.length > 0 ? medianOf(views) : null,
      maxViews: views.length > 0 ? views[views.length - 1]! : null,
      truncated: fetched.length > STATS_SOURCE_CAP,
    };
  },
});
