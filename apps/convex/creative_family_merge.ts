import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { ownerIdFor } from "./instance_ownership.js";

// Merging one Creative Family into another (ADR-082). No progress is stored:
// "what is left to move" is read from the data, so calling again after an
// interruption resumes, and a Source already moved is never touched twice.

/** The most Sources moved by one call; the page repeats the call until none remain. */
export const MERGE_BATCH = 100;

/**
 * Moves up to MERGE_BATCH Sources of `fromFamilyId` into `intoFamilyId` and
 * reports how many remain (read after the move, capped at MERGE_BATCH;
 * 0 means done). When none remain, in the same transaction, the source
 * family is archived and records `mergedIntoId`. Sources are re-pointed, never
 * deleted. Refused for the same family, an archived target, or a family that
 * is not in the caller's Instance.
 */
export const merge = mutation({
  args: { instanceId: v.string(), fromFamilyId: v.id("creativeFamilies"), intoFamilyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    const ownerId = await ownerIdFor(ctx, args.instanceId);
    if (args.fromFamilyId === args.intoFamilyId) throw new Error("A family cannot be merged into itself");
    const from = await ctx.db.get(args.fromFamilyId);
    const into = await ctx.db.get(args.intoFamilyId);
    if (!from || from.instanceId !== args.instanceId || !into || into.instanceId !== args.instanceId) {
      throw new Error("Creative Family not found");
    }
    if (into.status === "archived") throw new Error("Cannot merge into an archived family");
    // Already merged elsewhere: its Sources went to another family.
    if (from.status === "archived" && from.mergedIntoId !== undefined && from.mergedIntoId !== into._id) {
      throw new Error("This family was already merged into another one");
    }

    const leftToMove = (limit: number) =>
      ctx.db
        .query("sources")
        .withIndex("by_instance_owner_creativeFamily_createdAt", (q) =>
          q.eq("instanceId", args.instanceId).eq("ownerId", ownerId).eq("creativeFamilyId", from._id),
        )
        .take(limit);

    const batch = await leftToMove(MERGE_BATCH);
    for (const source of batch) await ctx.db.patch(source._id, { creativeFamilyId: into._id });
    const remaining = (await leftToMove(MERGE_BATCH)).length;
    if (remaining === 0 && !(from.status === "archived" && from.mergedIntoId === into._id)) {
      await ctx.db.patch(from._id, { status: "archived", mergedIntoId: into._id });
    }
    return { moved: batch.length, remaining };
  },
});
