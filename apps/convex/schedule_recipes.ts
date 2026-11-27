import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { RECIPE_UNAVAILABLE } from "./schedule_reasons.js";
import { assertRecipeCompatible, isCreativeMissionType } from "./mission_recipe.js";

// The recipe of a Schedule (ADR-091). A Schedule of a creative Mission type carries a compatible Production Recipe;
// one that loses it is paused with a reason and cannot resume until a compatible recipe is set.


/**
 * The recipe a Schedule is created or edited with: required and compatible for a creative Mission type (the same rule
 * as the Composer), refused for an operational one. Returns what to store.
 */
export async function resolveScheduleRecipe(
  ctx: QueryCtx,
  args: { instanceId: string; templateId: string; type: string; recipeId?: Id<"productionRecipes"> | undefined },
): Promise<Id<"productionRecipes"> | undefined> {
  const creative = await isCreativeMissionType(ctx, args.instanceId, args.templateId, args.type);
  if (args.recipeId === undefined) {
    if (creative) {
      throw new Error(`Mission type "${args.type}" is creative: a Schedule requires a Production Recipe (the Default Recipe for plain content)`);
    }
    return undefined;
  }
  if (!creative) throw new Error(`Mission type "${args.type}" is operational: it takes no Production Recipe`);
  await assertRecipeCompatible(ctx, { instanceId: args.instanceId, templateId: args.templateId, type: args.type, pinnedVersion: undefined, recipeId: args.recipeId });
  return args.recipeId;
}

/** Throws unless a creative Schedule carries a compatible recipe; an operational one passes. Used before resuming. */
export async function assertScheduleRunnable(ctx: QueryCtx, schedule: Doc<"schedules">): Promise<void> {
  if (!(await isCreativeMissionType(ctx, schedule.instanceId, schedule.templateId, schedule.type))) return;
  if (schedule.pausedReason || !schedule.recipeId) {
    throw new Error("This Schedule has no usable Production Recipe: choose a compatible one before resuming it");
  }
  await assertRecipeCompatible(ctx, {
    instanceId: schedule.instanceId, templateId: schedule.templateId, type: schedule.type, pinnedVersion: undefined, recipeId: schedule.recipeId,
  });
}

/** The Default Recipe of a Mission type: the Bundled Recipe its Template marked as default. Never created here. */
export async function defaultRecipeOf(ctx: QueryCtx, instanceId: string, templateId: string, missionType: string): Promise<Doc<"productionRecipes"> | null> {
  const rows = await ctx.db
    .query("productionRecipes")
    .withIndex("by_instance_target", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("missionType", missionType))
    .collect();
  return rows.find((row) => row.bundledId !== undefined && row.isDefault === true) ?? null;
}

/** The Schedules that use a recipe, for the deletion impact and the pause. */
export async function schedulesUsingRecipe(ctx: QueryCtx, recipeId: Id<"productionRecipes">): Promise<Doc<"schedules">[]> {
  return await ctx.db.query("schedules").withIndex("by_recipe", (q) => q.eq("recipeId", recipeId)).collect();
}

/** Pauses a Schedule whose recipe is unavailable: the reference is dropped, the reason recorded, nothing replaces it. */
export async function pauseForUnavailableRecipe(ctx: MutationCtx, schedule: Doc<"schedules">): Promise<void> {
  await ctx.db.patch(schedule._id, { status: "paused", pausedReason: RECIPE_UNAVAILABLE, recipeId: undefined, updatedAt: Date.now() });
}
