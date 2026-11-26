import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { IN_FLIGHT_STATUSES, type GenerationPin } from "./recipe_generation_shared.js";
import { readOwnerId } from "./instance_ownership.js";

// What the Recipes workspace shows of Recipe Generations (ADR-087, ADR-088). Read-only: the state of a generation
// is derived from its last Run, no status is stored. One generation is one row whatever its number of tries.

/** Generations shown in the history. */
export const GENERATIONS_SHOWN = 10;

export type GenerationState = "in_progress" | "ready_to_review" | "no_opportunity" | "failed" | "created" | "recipe_deleted";

const IN_FLIGHT = new Set<string>(IN_FLIGHT_STATUSES);

type RunPin = GenerationPin;
type GenerationRun = Doc<"runs"> & { recipeGeneration: RunPin };
const isGenerationRun = (run: Doc<"runs">): run is GenerationRun => "recipeGeneration" in run && run.recipeGeneration !== undefined;

type Outcome = { proposal?: unknown; no_opportunity?: { reason: string; details?: string } };
const outcomeOf = (run: Doc<"runs">): Outcome | undefined => ("recipeProposal" in run ? (run.recipeProposal as Outcome | undefined) : undefined);

/** The state of a generation, from its last Run. `reason`/`details` explain a no opportunity or a failure. */
export function deriveGeneration(last: Doc<"runs">): { state: GenerationState; reason?: string; details?: string } {
  if (IN_FLIGHT.has(last.status)) return { state: "in_progress" };
  const outcome = outcomeOf(last);
  if (last.status === "completed") {
    if ("recipeId" in last && last.recipeId) return { state: "created" };
    if (outcome?.proposal) return { state: "ready_to_review" };
    if (outcome?.no_opportunity) {
      const { reason, details } = outcome.no_opportunity;
      return { state: "no_opportunity", reason, ...(details ? { details } : {}) };
    }
    return { state: "failed", reason: "The Agent returned no result." };
  }
  const message = last.errorMessage?.replace(/^invalid_result:\s*/, "").trim();
  return { state: "failed", reason: message || (last.status === "cancelled" ? "The generation was cancelled." : "The generation failed.") };
}

async function lastRunOf(ctx: Pick<QueryCtx, "db">, generationId: Id<"runs">): Promise<GenerationRun | null> {
  const tries = await ctx.db.query("runs").withIndex("by_generation", (q) => q.eq("recipeGeneration.generationId", generationId)).take(10);
  return tries.filter(isGenerationRun).reduce<GenerationRun | null>((best, run) => (best === null || run.recipeGeneration.tryCount > best.recipeGeneration.tryCount ? run : best), null);
}

/** The latest generations of the Project (newest first), one row each, and whether one is in flight. */
export const listGenerations = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return { generations: [], inFlight: false };
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_instance_try", (q) => q.eq("instanceId", args.instanceId).eq("recipeGeneration.tryCount", 1))
      .order("desc")
      .take(GENERATIONS_SHOWN);
    const firstTries = rows.filter(isGenerationRun);
    const generations = [];
    for (const first of firstTries) {
      const last = (await lastRunOf(ctx, first._id)) ?? first;
      const proposal = outcomeOf(last)?.proposal;
      const derived = deriveGeneration(last);
      // The Recipe it created was deleted since: the generation is over and cannot be reviewed again.
      const recipeDeleted = derived.state === "created" && "recipeId" in last && last.recipeId !== undefined && (await ctx.db.get(last.recipeId)) === null;
      generations.push({
        generationId: first._id,
        // The Run to review and create from (ticket #195: `productionRecipes.create` takes it as `proposalRunId`).
        runId: last._id,
        createdAt: first.createdAt,
        tryCount: last.recipeGeneration.tryCount,
        ...(first.recipeGeneration.idea ? { idea: first.recipeGeneration.idea } : {}),
        ...(first.recipeGeneration.instructions ? { instructions: first.recipeGeneration.instructions } : {}),
        ...(recipeDeleted ? { state: "recipe_deleted" as const } : derived),
        ...(proposal !== undefined && !recipeDeleted ? { proposal } : {}),
        ...("recipeId" in last && last.recipeId && !recipeDeleted ? { recipeId: last.recipeId } : {}),
      });
    }
    return { generations, inFlight: generations.some((g) => g.state === "in_progress") };
  },
});

/** The Sources a Recipe Proposal cites (read-only on the review form): id and title. Sources since deleted are skipped. */
export const proposalSources = query({
  args: { instanceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    const run = await ctx.db.get(args.runId);
    if (!run || run.instanceId !== args.instanceId || !isGenerationRun(run)) return [];
    const proposal = outcomeOf(run)?.proposal as { sourceIds?: string[] } | undefined;
    const cited = [];
    for (const raw of (proposal?.sourceIds ?? []).slice(0, 50)) {
      const id = ctx.db.normalizeId("sources", raw);
      const source = id ? await ctx.db.get(id) : null;
      if (source && source.instanceId === args.instanceId) cited.push({ sourceId: source._id, title: source.marketing.summary ?? source.origin });
    }
    return cited;
  },
});
