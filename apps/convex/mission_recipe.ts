import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { isRecipeTarget } from "./production_recipe_rules.js";
import { latestVersion, ownedRecipe } from "./production_recipes.js";
import { getTemplateRegistry } from "./template_registry.js";

// The recipe argument of `missions.create` and the Recipe Snapshot it produces
// (issue #137, ADR-083). Every check runs before anything is written, so a
// refused creation leaves nothing behind.

export const recipeArgV = v.object({
  recipeId: v.id("productionRecipes"),
  /** Defaults to the recipe's latest version, pinned from then on. */
  version: v.optional(v.number()),
});

export type RecipeArg = {
  recipeId: Id<"productionRecipes">;
  version?: number;
};

export type RecipeSnapshot = NonNullable<Doc<"missions">["recipeSnapshot"]>;

type MissionRecipeArgs = {
  instanceId: string;
  templateId: string;
  type: string;
  /** The version the Mission is pinned to; undefined follows the current one. */
  pinnedVersion: string | undefined;
};

/**
 * The one Recipe Compatibility rule (ADR-091), shared by Mission creation, Schedules and Content Planning.
 * The recipe belongs to the Project, is written for this Template and Mission type, and the type is creative in
 * the pinned Template version. Read-only: never provisions, never picks a recipe. Returns the recipe row.
 */
export async function assertRecipeCompatible(
  ctx: QueryCtx,
  args: MissionRecipeArgs & { recipeId: Id<"productionRecipes"> },
): Promise<Doc<"productionRecipes">> {
  const recipe = await ownedRecipe(ctx, args.instanceId, args.recipeId);
  if (!recipe) throw new Error("Production Recipe not found");
  if (recipe.templateId !== args.templateId || recipe.missionType !== args.type) {
    throw new Error(`This Production Recipe is not written for Mission type "${args.type}" of ${args.templateId}`);
  }
  const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId, args.pinnedVersion);
  if (!template || !isRecipeTarget(template.manifest, args.type)) {
    throw new Error(
      `Mission type "${args.type}" is not creative in the Template version this Mission is pinned to${args.pinnedVersion ? ` (${args.pinnedVersion})` : ""}: it takes no Production Recipe`,
    );
  }
  return recipe;
}

/** Copies a version of a compatible recipe into a Recipe Snapshot. */
export async function buildRecipeSnapshot(ctx: QueryCtx, args: MissionRecipeArgs & { recipe: RecipeArg }): Promise<RecipeSnapshot> {
  const { recipe: arg } = args;
  const recipe = await assertRecipeCompatible(ctx, { ...args, recipeId: arg.recipeId });
  const version =
    arg.version === undefined
      ? await latestVersion(ctx, recipe._id)
      : await ctx.db
          .query("productionRecipeVersions")
          .withIndex("by_recipe_version", (q) => q.eq("recipeId", recipe._id).eq("version", arg.version!))
          .unique();
  if (!version) throw new Error(`Production Recipe has no version ${arg.version ?? ""}`.trim());

  return {
    recipeId: recipe._id,
    recipeName: recipe.name,
    version: version.version,
    ...(version.prompt === undefined ? {} : { prompt: version.prompt }),
    instructions: version.instructions,
    constraints: version.constraints,
  };
}

/**
 * The recipe side of a Mission creation: a creative Mission type (in the pinned Template version) requires an
 * explicit compatible recipe and gets its Recipe Snapshot; an operational one takes none. Refuses before anything
 * is written. Returns undefined for an operational Mission type.
 */
export async function resolveMissionRecipeSnapshot(
  ctx: QueryCtx,
  args: MissionRecipeArgs & { recipe: RecipeArg | undefined },
): Promise<RecipeSnapshot | undefined> {
  const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId, args.pinnedVersion);
  const creative = template !== null && template !== undefined && isRecipeTarget(template.manifest, args.type);
  if (!args.recipe) {
    if (creative) {
      throw new Error(`Mission type "${args.type}" is creative: a Mission requires a Production Recipe (pick one compatible with it, the Default Recipe for plain content)`);
    }
    return undefined;
  }
  return await buildRecipeSnapshot(ctx, { ...args, recipe: args.recipe });
}
