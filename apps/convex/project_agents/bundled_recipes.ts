import type { ActionCtx } from "../_generated/server.js";
import { internal } from "../_generated/api.js";

/**
 * Provisions the Bundled Recipes of the Template once the Agent is active (ADR-091), so a Project that lost them or
 * never got them (an Agent added before the Template shipped recipes) has them. Idempotent. A failure never fails the
 * activation, like the default Schedules: the next install, update or activation provisions again.
 */
export async function provisionBundledRecipesOf(ctx: ActionCtx, projectId: string, templateId: string): Promise<void> {
  try {
    await ctx.runMutation(internal.bundled_recipes.provisionCurrent, { projectId, templateId });
  } catch (error) {
    console.error(`Bundled Recipes of ${templateId} were not provisioned`, error);
  }
}
