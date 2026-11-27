import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";

// What the modules of a Recipe Generation (ADR-087) share: its limits, the Internal MCP tools it needs
// and the per-Agent exclusion every Run starter reads.

/** Tries of one generation: the first Run and its retries after a refused result. */
export const MAX_RECIPE_GENERATION_TRIES = 3;

export const MAX_INSTRUCTIONS_LENGTH = 2000;

/** The most Sources one generation reads: what an Agent can read in a run, and the page limit of the Source list. */
export const MAX_GENERATION_SOURCES = 25;

/** True for a Source an Agent may read and cite: analysed (`ready`) and not excluded. */
export const isReadableSource = (source: Doc<"sources">) => source.status === "ready" && source.excluded !== true;

/** The Internal MCP tools the Agent needs; an Agent declaring all of them is eligible. */
export const RECIPE_GENERATION_TOOLS = [
  "get_brand_core",
  "list_generation_sources",
  "get_source",
  "list_production_recipes",
  "get_production_recipe",
  "list_mission_types",
] as const;

/** The statuses of a Run in flight. */
export const IN_FLIGHT_STATUSES = ["pending", "dispatching", "running", "awaiting_job"] as const;

type RunStatus = (typeof IN_FLIGHT_STATUSES)[number];
type Ctx = Pick<QueryCtx, "db">;
export type GenerationPin = NonNullable<Extract<Doc<"runs">, { recipeGeneration?: unknown }>["recipeGeneration"]>;

/** The `recipeGeneration` pin of a Run: the idea, the Sources and the instructions carry over, the rest is set per try. */
export function buildGenerationPin(
  base: { idea?: string; sourceIds: Id<"sources">[]; instructions?: string },
  extra: { tryCount: number; generationId?: GenerationPin["generationId"]; feedback?: string },
): GenerationPin {
  return {
    ...(base.idea ? { idea: base.idea } : {}),
    sourceIds: base.sourceIds,
    ...(base.instructions ? { instructions: base.instructions } : {}),
    tryCount: extra.tryCount,
    ...(extra.generationId ? { generationId: extra.generationId } : {}),
    ...(extra.feedback ? { feedback: extra.feedback } : {}),
  };
}

/** An Agent's Run in flight (any kind), or null. One bounded read per status, through the shared index. */
export async function runInFlight(ctx: Ctx, instanceId: string, templateId: string): Promise<Doc<"runs"> | null> {
  for (const status of IN_FLIGHT_STATUSES) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", status))
      .first();
    if (run) return run;
  }
  return null;
}

/** The first Standalone (Recipe Generation) Run of the Agent in one of `statuses`. The index range is streamed, so the answer is exact whatever the number of other Runs. */
async function firstGenerationRun(ctx: Ctx, instanceId: string, templateId: string, statuses: readonly RunStatus[]): Promise<Doc<"runs"> | null> {
  for (const status of statuses) {
    const runs = ctx.db
      .query("runs")
      .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", status));
    for await (const run of runs) {
      if ("recipeGeneration" in run && run.recipeGeneration) return run;
    }
  }
  return null;
}

/** The Agent's running Standalone Run, or null. */
export const runningGenerationRun = (ctx: Ctx, instanceId: string, templateId: string) => firstGenerationRun(ctx, instanceId, templateId, ["running"]);

/**
 * True while a Standalone Run is in flight for the Agent: the scheduled passes of its Jobs then leave everything
 * untouched (the Job stays due, a Run Now stays queued).
 */
export async function standaloneInFlight(ctx: Ctx, instanceId: string, templateId: string): Promise<boolean> {
  return (await firstGenerationRun(ctx, instanceId, templateId, IN_FLIGHT_STATUSES)) !== null;
}
