import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { readOwnerId } from "./instance_ownership.js";

// What the Creative Library shows of Recipe Generations (ADR-087, ticket #194). Read-only: the state of a generation
// is derived from its last Run, no status is stored. One generation is one row whatever its number of tries.

/** Generations shown on a family. */
export const GENERATIONS_SHOWN = 5;
/** Runs of the family read before keeping the first tries (up to MAX tries per generation). */
const FAMILY_RUN_SCAN = 100;

export type GenerationState = "in_progress" | "ready_to_review" | "no_opportunity" | "failed" | "created";

const IN_FLIGHT = new Set(["pending", "dispatching", "running", "awaiting_job"]);

type RunPin = NonNullable<Extract<Doc<"runs">, { recipeGeneration?: unknown }>["recipeGeneration"]>;
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

/** The five latest generations of a family (newest first), one row each, and whether one is in flight. */
export const listGenerations = query({
  args: { instanceId: v.string(), familyId: v.id("creativeFamilies") },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return { generations: [], inFlight: false };
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_instance_family", (q) => q.eq("instanceId", args.instanceId).eq("recipeGeneration.familyId", args.familyId))
      .order("desc")
      .take(FAMILY_RUN_SCAN);
    const firstTries = rows.filter(isGenerationRun).filter((run) => run.recipeGeneration.tryCount === 1).slice(0, GENERATIONS_SHOWN);
    const generations = [];
    for (const first of firstTries) {
      const last = (await lastRunOf(ctx, first._id)) ?? first;
      const proposal = outcomeOf(last)?.proposal;
      generations.push({
        generationId: first._id,
        // The Run to review and create from (ticket #195: `productionRecipes.create` takes it as `proposalRunId`).
        runId: last._id,
        createdAt: first.createdAt,
        tryCount: last.recipeGeneration.tryCount,
        ...(first.recipeGeneration.instructions ? { instructions: first.recipeGeneration.instructions } : {}),
        ...deriveGeneration(last),
        ...(proposal !== undefined ? { proposal } : {}),
        ...("recipeId" in last && last.recipeId ? { recipeId: last.recipeId } : {}),
      });
    }
    return { generations, inFlight: generations.some((g) => g.state === "in_progress") };
  },
});
