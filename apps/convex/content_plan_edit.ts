import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { mutation, query, type MutationCtx } from "./_generated/server.js";
import { isIsoDate, utcDateOf } from "@opengroow/protocol/content-planning-pins";
import { CONTENT_PLAN_LIMITS } from "./content_plan_rules.js";
import { NO_PINS_MESSAGE, pinsOf, resolveItem } from "./content_plans.js";
import { readOwnerId, requireOwnedRow } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";

// Editing a draft Content Plan (ADR-086, issue #180). The user may change a title, a brief, a date, the Recipe (another
// one of the same Mission type, so format and quota never change) and the Publish targets (only by removing), or remove
// a proposal (it becomes `rejected`, kept for history). Each edit is revalidated by the same rules as persistence
// (limits and dates from content_plan_rules, Recipe and Agent checks as in content_plans) and refused outside `draft`.

/** The proposal to edit, once ownership, the draft status of its plan and its own status are checked. */
async function editableContent(ctx: MutationCtx, contentId: Doc<"plannedContents">["_id"]) {
  const content = await ctx.db.get(contentId);
  if (!content) throw new Error("Planned Content not found.");
  await requireOwnedRow(ctx, content);
  const plan = await ctx.db.get(content.planId);
  if (!plan || plan.status !== "draft") throw new Error("Only the contents of a draft Content Plan can be edited.");
  if (content.status !== "proposed") throw new Error("This content was removed from the plan.");
  return { content, plan };
}

export const update = mutation({
  args: {
    contentId: v.id("plannedContents"),
    title: v.optional(v.string()),
    brief: v.optional(v.string()),
    plannedAt: v.optional(v.string()),
    recipeId: v.optional(v.id("productionRecipes")),
    publishTargets: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { content, plan } = await editableContent(ctx, args.contentId);
    const L = CONTENT_PLAN_LIMITS;
    const patch: Partial<Doc<"plannedContents">> = {};

    if (args.title !== undefined) {
      if (args.title.trim() === "" || args.title.length > L.titleChars) throw new Error(`The title must be 1 to ${L.titleChars} characters.`);
      patch.title = args.title;
    }
    if (args.brief !== undefined) {
      if (args.brief.trim() === "" || args.brief.length > L.briefChars) throw new Error(`The brief must be 1 to ${L.briefChars} characters.`);
      patch.brief = args.brief;
    }
    if (args.plannedAt !== undefined) {
      if (!isIsoDate(args.plannedAt)) throw new Error("The date must be written YYYY-MM-DD.");
      if (args.plannedAt < plan.periodStart || args.plannedAt > plan.periodEnd) {
        throw new Error(`The date ${args.plannedAt} is outside the Planning period ${plan.periodStart} to ${plan.periodEnd}.`);
      }
      if (args.plannedAt < utcDateOf(Date.now())) throw new Error("The date is in the past.");
      patch.plannedAt = args.plannedAt;
    }
    if (args.recipeId !== undefined) {
      // The very rules of persistence and approval: Recipe, Agent, Source requirement, pinned format, Publisher compatibility.
      const carried = await pinsOf(ctx, plan);
      if (!carried) throw new Error(NO_PINS_MESSAGE);
      const outcome = await resolveItem(
        ctx, carried.run, carried.pins,
        { missionType: content.missionType, recipeId: args.recipeId, ...(content.sourceId ? { sourceId: content.sourceId } : {}) },
        "The Recipe", await projectPublishers(ctx, content.instanceId),
      );
      if (!outcome.ok) throw new Error(outcome.errors.join(" "));
      if (outcome.value.kind !== content.kind) throw new Error(`The Recipe produces format "${outcome.value.kind}", not "${content.kind}".`);
      patch.recipeId = args.recipeId;
    }
    if (args.publishTargets !== undefined) {
      if (args.publishTargets.length === 0) throw new Error("Keep at least one Publish target, or remove the content.");
      if (!args.publishTargets.every((target) => content.publishTargets.includes(target))) throw new Error("Publish targets can only be removed, never added.");
      patch.publishTargets = content.publishTargets.filter((target) => args.publishTargets!.includes(target));
      const publishers = await projectPublishers(ctx, content.instanceId);
      if (!patch.publishTargets.some((target) => channelOf(publishers, target))) {
        throw new Error("Keep at least one Publish target that is still available, or remove the content.");
      }
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(content._id, patch);
  },
});

/** Removing a proposal keeps it as `rejected`: it stays in the history and no longer counts toward the targets. */
export const remove = mutation({
  args: { contentId: v.id("plannedContents") },
  handler: async (ctx, args) => {
    const { content } = await editableContent(ctx, args.contentId);
    await ctx.db.patch(content._id, { status: "rejected" });
  },
});

/** The Recipes a proposal can switch to: the Project's, written for its Mission type. */
export const recipeOptions = query({
  args: { contentId: v.id("plannedContents") },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content || (await readOwnerId(ctx, content.instanceId)) === null) return [];
    const recipes = await ctx.db.query("productionRecipes").withIndex("by_instance_target", (q) => q.eq("instanceId", content.instanceId)).collect();
    return recipes.filter((recipe) => recipe.missionType === content.missionType).map((recipe) => ({ id: recipe._id, name: recipe.name }));
  },
});
