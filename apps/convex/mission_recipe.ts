import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { ownedConnection } from "./production_connections.js";
import { isCompatible, RECIPE_PROVIDER } from "./production_connection_rules.js";
import { latestVersion, ownedRecipe } from "./production_recipes.js";
import { resolveRecipeVersion } from "./production_recipe_resolver.js";
import { getTemplateRegistry } from "./template_registry.js";

// The recipe argument of `missions.create` and the Recipe Snapshot it produces
// (issue #137, ADR-083). Every check runs before anything is written, so a
// refused creation leaves nothing behind.

export const recipeArgV = v.object({
  connectionId: v.id("productionConnections"),
  /** Defaults to the recipe's latest version, pinned from then on. */
  version: v.optional(v.number()),
  /** Explicit values of the recipe's variables. */
  values: v.optional(v.record(v.string(), v.string())),
  /** Variables to draw at random. */
  vary: v.optional(v.array(v.string())),
});

export type RecipeArg = {
  connectionId: Id<"productionConnections">;
  version?: number;
  values?: Record<string, string>;
  vary?: string[];
};

export type RecipeSnapshot = NonNullable<Doc<"missions">["recipeSnapshot"]>;

/**
 * Checks, in order: the connection belongs to the Project and is not disabled;
 * its target matches the Template and Mission type; the payload satisfies its
 * compatibility rule; the pinned Template version declares the provider; the
 * recipe is not archived. Then resolves the variables into a snapshot.
 */
export async function buildRecipeSnapshot(
  ctx: QueryCtx,
  args: {
    instanceId: string;
    templateId: string;
    type: string;
    payload: unknown;
    /** The version the Mission is pinned to; undefined follows the current one. */
    pinnedVersion: string | undefined;
    recipe: RecipeArg;
  },
): Promise<RecipeSnapshot> {
  const { recipe: arg } = args;
  const connection = await ownedConnection(ctx, args.instanceId, arg.connectionId);
  if (!connection) throw new Error("Creative Connection not found");
  if (connection.status === "disabled") throw new Error("This Creative Connection is disabled");
  if (connection.templateId !== args.templateId || connection.missionType !== args.type) {
    throw new Error(`This Creative Connection does not target Mission type "${args.type}" of ${args.templateId}`);
  }
  if (!isCompatible(connection.compatibleWhen, args.payload)) {
    throw new Error("The Mission payload is not compatible with this Creative Connection");
  }
  const template = await getTemplateRegistry(ctx).resolve(args.instanceId, args.templateId, args.pinnedVersion);
  const declares = template?.manifest.missionTypes?.find((t) => t.type === args.type)?.contextProviders?.includes(RECIPE_PROVIDER);
  if (!declares) {
    throw new Error(
      `The Template version this Mission is pinned to${args.pinnedVersion ? ` (${args.pinnedVersion})` : ""} does not declare the ${RECIPE_PROVIDER} provider for "${args.type}"`,
    );
  }
  const recipe = await ownedRecipe(ctx, args.instanceId, connection.recipeId);
  if (!recipe) throw new Error("Production Recipe not found");
  if (recipe.status === "archived") throw new Error("This Production Recipe is archived");

  const version =
    arg.version === undefined
      ? await latestVersion(ctx, recipe._id)
      : await ctx.db
          .query("productionRecipeVersions")
          .withIndex("by_recipe_version", (q) => q.eq("recipeId", recipe._id).eq("version", arg.version!))
          .unique();
  if (!version) throw new Error(`Production Recipe has no version ${arg.version ?? ""}`.trim());

  const resolved = resolveRecipeVersion(version, { values: arg.values, vary: arg.vary });
  return {
    recipeId: recipe._id,
    recipeName: recipe.name,
    version: version.version,
    connectionId: connection._id,
    values: resolved.values,
    ...(resolved.prompt === undefined ? {} : { prompt: resolved.prompt }),
    instructions: resolved.instructions,
    constraints: resolved.constraints,
  };
}
