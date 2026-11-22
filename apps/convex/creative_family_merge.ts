import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { mutation } from "./_generated/server.js";
import { isActiveFamily, requireOwnedFamily } from "./creative_families.js";
import { ownerIdsFor } from "./instance_ownership.js";

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
    const ownerIds = await ownerIdsFor(ctx, args.instanceId);
    if (!ownerIds) throw new Error("Forbidden");
    if (args.fromFamilyId === args.intoFamilyId) throw new Error("A family cannot be merged into itself");
    const from = await requireOwnedFamily(ctx, args.instanceId, args.fromFamilyId);
    const into = await requireOwnedFamily(ctx, args.instanceId, args.intoFamilyId);
    if (!isActiveFamily(into)) throw new Error("Cannot merge into an archived family");
    // Already merged elsewhere: its Sources went to another family.
    if (!isActiveFamily(from) && from.mergedIntoId !== undefined && from.mergedIntoId !== into._id) {
      throw new Error("This family was already merged into another one");
    }

    // Sources are indexed per owner, and an Instance can hold rows of several.
    const leftToMove = async (limit: number) => {
      const found: Doc<"sources">[] = [];
      for (const ownerId of ownerIds) {
        if (found.length >= limit) break;
        found.push(
          ...(await ctx.db
            .query("sources")
            .withIndex("by_instance_owner_creativeFamily_createdAt", (q) =>
              q.eq("instanceId", args.instanceId).eq("ownerId", ownerId).eq("creativeFamilyId", from._id),
            )
            .take(limit - found.length)),
        );
      }
      return found;
    };

    const batch = await leftToMove(MERGE_BATCH);
    for (const source of batch) await ctx.db.patch(source._id, { creativeFamilyId: into._id });
    const remaining = (await leftToMove(MERGE_BATCH)).length;
    if (remaining === 0 && (isActiveFamily(from) || from.mergedIntoId !== into._id)) {
      await ctx.db.patch(from._id, { status: "archived", mergedIntoId: into._id });
    }
    return { moved: batch.length, remaining };
  },
});
