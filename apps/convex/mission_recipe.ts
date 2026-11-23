import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { declaresRecipeProvider, RECIPE_PROVIDER } from "./production_recipe_rules.js";
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

/**
 * Checks, in order: the recipe belongs to the Project and is not archived; it is
 * written for this Template and Mission type; the pinned Template version
 * declares the provider. Then copies the version into a snapshot.
 */
export async function buildRecipeSnapshot(
  ctx: QueryCtx,
  args: {
    instanceId: string;
    templateId: string;
    type: string;
    /** The version the Mission is pinned to; undefined follows the current one. */
    pinnedVersion: string | undefined;
    recipe: RecipeArg;
  },
): Promise<RecipeSnapshot> {
  const { recipe: arg } = args;
  const recipe = await ownedRecipe(ctx, args.instanceId, arg.recipeId);
  if (!recipe) throw new Error("Production Recipe not found");
  if (recipe.status === "archived") throw new Error("This Production Recipe is archived");
  if (recipe.templateId !== args.templateId || recipe.missionType !== args.type) {
    throw new Error(`This Production Recipe is not written for Mission type "${args.type}" of ${args.templateId}`);
  }
  const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId, args.pinnedVersion);
  if (!template || !declaresRecipeProvider(template.manifest, args.type)) {
    throw new Error(
      `The Template version this Mission is pinned to${args.pinnedVersion ? ` (${args.pinnedVersion})` : ""} does not declare the ${RECIPE_PROVIDER} provider for "${args.type}"`,
    );
  }
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
