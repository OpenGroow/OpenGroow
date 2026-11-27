import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { query } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";
import { latestOf } from "./strategic_reviews.js";

// Dashboard reads of the Strategic Memory (ADR-085, issue #167). Read-only and
// scoped to the caller's Project: persistence lives in `strategic_reviews.ts`,
// and nothing here updates or deletes a Review.

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

/** What the page shows of a Review (never its `ownerId`). */
function reviewView(review: Doc<"strategicReviews">) {
  const { _id, periodStart, periodEnd, report, consolidatedMemory, memoryChanged, createdAt } = review;
  return { _id, periodStart, periodEnd, report, consolidatedMemory, memoryChanged, createdAt };
}

/** The Project's current Strategic Memory (its latest Review), or null. */
export const current = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const latest = await latestOf(ctx, args.instanceId);
    return latest ? reviewView(latest) : null;
  },
});

/** The Project's Strategic Reviews, newest first, paginated. */
export const history = query({
  args: { instanceId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return EMPTY_PAGE;
    const result = await ctx.db.query("strategicReviews").withIndex("by_instance_created", (q) => q.eq("instanceId", args.instanceId)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(reviewView) };
  },
});

/**
 * The entities a Review references, for links. One deleted since (or of
 * another Project) has a null name.
 */
export const references = query({
  args: { instanceId: v.string(), reviewId: v.id("strategicReviews") },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.instanceId !== args.instanceId) return null;
    const own = <T extends { instanceId: string }>(doc: T | null) => (doc && doc.instanceId === args.instanceId ? doc : null);

    const recipes = await Promise.all(
      review.references.recipeIds.map(async (id) => {
        const recipe = own(await ctx.db.get(id));
        return { id, name: recipe?.name ?? null };
      }),
    );
    const publications = await Promise.all(
      review.references.publicationIds.map(async (id) => {
        const publication = own(await ctx.db.get(id));
        return { id, target: publication?.target ?? null, missionId: publication?.missionId ?? null };
      }),
    );
    return { recipes, publications };
  },
});
