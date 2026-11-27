import type { Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";

// The two reads of a Production Recipe that the recipe modules share (production_recipes, mission_recipe,
// bundled_recipes, recipe_generation_reads). They depend on nothing else, so those modules do not import each other in
// a ring.

/** A recipe of the caller's Instance, or null (another Instance's recipe is "not found"). */
export async function ownedRecipe(ctx: QueryCtx, instanceId: string, recipeId: Id<"productionRecipes">) {
  const recipe = await ctx.db.get(recipeId);
  return recipe && recipe.instanceId === instanceId ? recipe : null;
}

/** The newest version of a recipe, or null. */
export async function latestVersion(ctx: QueryCtx, recipeId: Id<"productionRecipes">) {
  return await ctx.db
    .query("productionRecipeVersions")
    .withIndex("by_recipe_version", (q) => q.eq("recipeId", recipeId))
    .order("desc")
    .first();
}
