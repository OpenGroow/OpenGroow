import type { Doc } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";

// What the modules of a Recipe Generation (ADR-087) share: its limits, the Internal MCP tools it needs
// and the per-Agent exclusion every Run starter reads.

/** Tries of one generation: the first Run and its retries after a refused result. */
export const MAX_RECIPE_GENERATION_TRIES = 3;

export const MAX_INSTRUCTIONS_LENGTH = 2000;

/** The Internal MCP tools the Agent needs; an Agent declaring all of them is eligible. */
export const RECIPE_GENERATION_TOOLS = [
  "get_brand_core",
  "get_creative_family",
  "list_family_sources",
  "get_source",
  "list_production_recipes",
  "get_production_recipe",
  "list_mission_types",
] as const;

const IN_FLIGHT_STATUSES = ["pending", "dispatching", "running", "awaiting_job"] as const;

/** An Agent's Run in flight (any kind), or null. One bounded read per status, through the shared index. */
export async function runInFlight(ctx: Pick<QueryCtx, "db">, instanceId: string, templateId: string): Promise<Doc<"runs"> | null> {
  for (const status of IN_FLIGHT_STATUSES) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", status))
      .first();
    if (run) return run;
  }
  return null;
}

/**
 * True while a Standalone Run is in flight for the Agent: the scheduled passes of its Jobs then leave everything
 * untouched (the Job stays due, a Run Now stays queued).
 */
export async function standaloneInFlight(ctx: Pick<QueryCtx, "db">, instanceId: string, templateId: string): Promise<boolean> {
  for (const status of IN_FLIGHT_STATUSES) {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", status))
      .take(100);
    if (runs.some((run) => "recipeGeneration" in run && run.recipeGeneration)) return true;
  }
  return false;
}
