import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server.js";
import { originKeyOf } from "./source_origin.js";
import { deleteSource } from "./sources.js";

// One-off cleanup of the Sources that were ingested before a post could only be
// ingested once (`source_origin.ts`): the same post captured on several days.
// Nothing here runs by itself. `report` only reads; `removeDuplicates` deletes
// and does nothing unless it is told to.

const PAGE = 100;
const SCAN_LIMIT = 5000;

/** Gives `originKey` to the Sources written before it existed. Pages itself until done. */
export const backfillOriginKeys = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("sources").paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    for (const source of page.page) {
      const originKey = originKeyOf(source.origin);
      if (source.originKey === undefined && originKey !== undefined) await ctx.db.patch(source._id, { originKey });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.source_dedupe.backfillOriginKeys, { cursor: page.continueCursor });
  },
});

type Group = { keep: Doc<"sources">; remove: Doc<"sources">[] };

/** The Sources of an Instance grouped by Agent and post. Per group, the one to keep is the
 * one that already led to a production Mission, else the oldest capture. A duplicate that
 * itself has a production Mission is never removed. */
async function duplicateGroups(ctx: QueryCtx, instanceId: string): Promise<Group[]> {
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_instance_owner_createdAt", (q) => q.eq("instanceId", instanceId))
    .take(SCAN_LIMIT);
  const byPost = new Map<string, Doc<"sources">[]>();
  for (const source of sources) {
    const key = source.originKey ?? originKeyOf(source.origin);
    if (key === undefined) continue;
    const id = `${source.templateId}|${key}`;
    byPost.set(id, [...(byPost.get(id) ?? []), source]);
  }
  const groups: Group[] = [];
  for (const members of byPost.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => a.capturedAt - b.capturedAt);
    const keep = ordered.find((source) => source.productionMissionId !== undefined) ?? ordered[0]!;
    groups.push({ keep, remove: ordered.filter((source) => source._id !== keep._id && source.productionMissionId === undefined) });
  }
  return groups;
}

const summaryOf = (source: Doc<"sources">) => ({
  id: source._id,
  capturedAt: source.capturedAt,
  status: source.status,
  scored: source.scoring !== undefined,
  hasMission: source.productionMissionId !== undefined,
  summary: (source.marketing.summary ?? "").slice(0, 80),
});

/** What `removeDuplicates` would delete, without deleting anything. */
export const report = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const groups = await duplicateGroups(ctx, args.instanceId);
    return {
      posts: groups.length,
      toRemove: groups.reduce((total, group) => total + group.remove.length, 0),
      groups: groups.map((group) => ({ origin: group.keep.origin, keep: summaryOf(group.keep), remove: group.remove.map(summaryOf) })),
    };
  },
});

/** Deletes the duplicates `report` lists (and their stored thumbnails). Refuses unless `confirm` is true. */
export const removeDuplicates = internalMutation({
  args: { instanceId: v.string(), confirm: v.boolean() },
  handler: async (ctx, args) => {
    if (!args.confirm) throw new Error("removeDuplicates deletes Sources for good: pass confirm: true after reading the report");
    const groups = await duplicateGroups(ctx, args.instanceId);
    let removed = 0;
    for (const group of groups) {
      for (const source of group.remove) {
        await deleteSource(ctx, source);
        removed += 1;
      }
    }
    return { removed };
  },
});
