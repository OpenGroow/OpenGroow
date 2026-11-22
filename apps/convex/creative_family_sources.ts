import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { isActiveFamily, requireOwnedFamily } from "./creative_families.js";
import { ownerIdsFor } from "./instance_ownership.js";

// Hand classification of Sources into Creative Families (ADR-082). A Source
// carries at most one family (`creativeFamilyId`), so assigning moves it and
// removing only clears the link: the Source itself is never deleted.

/** The caller's Source of this Instance; throws "Forbidden" for a stranger, "Source not found" otherwise. */
async function ownedSource(ctx: MutationCtx, instanceId: string, sourceId: Id<"sources">) {
  const ownerIds = await ownerIdsFor(ctx, instanceId);
  if (!ownerIds) throw new Error("Forbidden");
  const source = await ctx.db.get(sourceId);
  if (!source || source.instanceId !== instanceId || !ownerIds.has(source.ownerId)) throw new Error("Source not found");
  return source;
}

/** Puts a Source in a family, replacing any previous one; refused for an archived family. */
export const assign = mutation({
  args: { instanceId: v.string(), sourceId: v.id("sources"), familyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    const source = await ownedSource(ctx, args.instanceId, args.sourceId);
    const family = await requireOwnedFamily(ctx, args.instanceId, args.familyId);
    if (!isActiveFamily(family)) throw new Error("This Creative Family is archived");
    if (source.creativeFamilyId === args.familyId) return null;
    await ctx.db.patch(args.sourceId, { creativeFamilyId: args.familyId });
    return null;
  },
});

/** Takes a Source out of its family; it becomes unclassified and is kept. */
export const remove = mutation({
  args: { instanceId: v.string(), sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ownedSource(ctx, args.instanceId, args.sourceId);
    if (source.creativeFamilyId === undefined) return null;
    await ctx.db.patch(args.sourceId, { creativeFamilyId: undefined });
    return null;
  },
});
