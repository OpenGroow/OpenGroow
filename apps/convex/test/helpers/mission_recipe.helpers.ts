import { api } from "../../_generated/api";

type Caller = unknown;

/**
 * A Custom Production Recipe for a creative Mission type of an installed Template, in the explicit form
 * `missions.create` requires (ADR-091). For tests whose subject is not the recipe.
 */
export async function recipeFor(as: Caller, instanceId: string, templateId: string, missionType: string) {
  const { recipeId } = (await (as as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation(api.production_recipes.create, {
    instanceId, templateId, missionType, name: "Plain", description: "", instructions: "Follow the Mission Brief.", constraints: [],
  })) as { recipeId: string };
  return { recipeId } as never;
}
