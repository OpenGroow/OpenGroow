import { v } from "convex/values";
import { internalQuery, mutation, type MutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { ownerIdFor } from "./instance_ownership.js";
import { isActiveFamily, requireOwnedFamily } from "./creative_families.js";
import { getTemplateRegistry } from "./template_registry.js";
import { requireValidTarget } from "./production_recipes.js";
import { buildRecipeGenerationRunFile } from "./recipe_generation_run_file.js";
import { parseRecipeResult } from "./recipe_proposal.js";
import type { RunResult } from "./run_result.js";
import {
  MAX_GENERATION_SOURCES,
  isReadableSource,
  MAX_INSTRUCTIONS_LENGTH,
  buildGenerationPin,
  MAX_RECIPE_GENERATION_TRIES,
  RECIPE_GENERATION_TOOLS,
  runInFlight,
} from "./recipe_generation_shared.js";

// Recipe Generation (ADR-087): a Standalone Run of the Strategy Agent that returns at most one Recipe Proposal.
// This module owns the start (with its guards and the per-Agent exclusion), the validation of the result and the
// retry of a refused one. Nothing here creates a Recipe: that is `productionRecipes.create` with a `proposalRunId`.

const SOURCE_SCAN_LIMIT = 500;
const AGENT_SCAN_LIMIT = 50;

/** A family's readable Sources, most recent first (bounded scan). */
async function readableFamilySources(ctx: MutationCtx, instanceId: string, ownerId: string, familyId: Id<"creativeFamilies">): Promise<Doc<"sources">[]> {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_instance_owner_creativeFamily_createdAt", (q) => q.eq("instanceId", instanceId).eq("ownerId", ownerId).eq("creativeFamilyId", familyId))
    .order("desc")
    .take(SOURCE_SCAN_LIMIT);
  return rows.filter(isReadableSource);
}

/**
 * What a generation reads, resolved once at its start: the Sources the user selected (all of them, or the start is
 * refused) then, up to the limit, the most recent readable Sources of the selected families.
 */
async function resolveSources(ctx: MutationCtx, instanceId: string, ownerId: string, selected: Id<"sources">[], familyIds: Id<"creativeFamilies">[]): Promise<Id<"sources">[]> {
  const explicit = [...new Set(selected)];
  if (explicit.length > MAX_GENERATION_SOURCES) {
    throw new Error(`${explicit.length} Sources are selected, a generation reads at most ${MAX_GENERATION_SOURCES}: unselect some.`);
  }
  const [documents, familySources] = await Promise.all([
    Promise.all(explicit.map((id) => ctx.db.get(id))),
    Promise.all(
      [...new Set(familyIds)].map(async (familyId) => {
        const family = await requireOwnedFamily(ctx, instanceId, familyId);
        if (!isActiveFamily(family)) throw new Error("This Creative Family is archived: its Sources cannot be selected.");
        return await readableFamilySources(ctx, instanceId, ownerId, familyId);
      }),
    ),
  ]);
  explicit.forEach((id, i) => {
    const source = documents[i];
    if (!source || source.instanceId !== instanceId || source.ownerId !== ownerId) throw new Error(`Source ${id} is not a Source of this Project`);
    if (!isReadableSource(source)) throw new Error(`Source ${id} is not ready or is excluded: an Agent cannot read it.`);
  });
  const fromFamilies = new Map<Id<"sources">, number>(familySources.flat().map((source) => [source._id, source.capturedAt]));
  const taken = new Set(explicit);
  const room = [...fromFamilies].filter(([id]) => !taken.has(id)).sort((a, b) => b[1] - a[1]).slice(0, MAX_GENERATION_SOURCES - explicit.length);
  return [...explicit, ...room.map(([id]) => id)];
}

/** The first active Agent of the Project whose Internal MCP declaration lists every tool a generation needs. */
async function eligibleAgent(ctx: MutationCtx, instanceId: string): Promise<Doc<"projectAgents"> | null> {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "active"))
    .take(AGENT_SCAN_LIMIT);
  const registry = getTemplateRegistry(ctx);
  for (const agent of agents) {
    if (agent.workspaceKey === undefined) continue;
    const template = await registry.resolve(instanceId, agent.templateId);
    const declared = new Set((template?.manifest.mcpServers ?? []).flatMap((server) => server.internal?.tools ?? []));
    if (RECIPE_GENERATION_TOOLS.every((tool) => declared.has(tool))) return agent;
  }
  return null;
}

/**
 * Asks the Strategy Agent for a Recipe Proposal from a free idea and/or Sources (a Creative Family is only a shortcut
 * that selects several). Returns the Run, shown as the generation.
 */
export const generateRecipe = mutation({
  args: {
    instanceId: v.string(),
    idea: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.id("sources"))),
    familyIds: v.optional(v.array(v.id("creativeFamilies"))),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"runs"> }> => {
    const ownerId = await ownerIdFor(ctx, args.instanceId);
    const instructions = args.instructions?.trim();
    if (instructions && instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      throw new Error(`The additional instructions are limited to ${MAX_INSTRUCTIONS_LENGTH} characters.`);
    }
    const idea = args.idea?.trim() || undefined;
    const sourceIds = await resolveSources(ctx, args.instanceId, ownerId, args.sourceIds ?? [], args.familyIds ?? []);
    if (!idea && sourceIds.length === 0) throw new Error("A Recipe Generation needs a free idea or at least one Source that is ready.");
    const agent = await eligibleAgent(ctx, args.instanceId);
    if (!agent) throw new Error("No active Agent of this Project declares the tools a Recipe Generation needs.");
    if (await runInFlight(ctx, args.instanceId, agent.templateId)) throw new Error("Agent busy: it is working on another Run, try again when it is done.");
    const now = Date.now();
    const input = { idea, sourceIds, instructions };
    const runId = await ctx.db.insert("runs", {
      ownerId,
      instanceId: args.instanceId,
      templateId: agent.templateId,
      agentName: agent.openclawAgentName ?? agent.templateId,
      sessionKey: "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      recipeGeneration: buildGenerationPin(input, { tryCount: 1 }),
    });
    await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}`, recipeGeneration: buildGenerationPin(input, { tryCount: 1, generationId: runId }) });
    return { runId };
  },
});

/**
 * A Recipe Generation Run failed or was cancelled (the caller already marked it failed). When `reasons` are given (a
 * refused or unreadable result) and the budget allows, the next try is inserted here, in the same mutation, so the
 * Agent's lock is never released between two tries. Otherwise the generation ends and nothing was created.
 */
export async function failRecipeGenerationRun(ctx: MutationCtx, run: Doc<"runs">, reasons?: string[]): Promise<void> {
  if (!("recipeGeneration" in run) || !run.recipeGeneration) return;
  const pin = run.recipeGeneration;
  if (!reasons || pin.tryCount >= MAX_RECIPE_GENERATION_TRIES) return;
  const now = Date.now();
  const runId = await ctx.db.insert("runs", {
    ownerId: run.ownerId,
    instanceId: run.instanceId,
    templateId: run.templateId,
    agentName: run.agentName,
    sessionKey: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    resumedFromRunId: run._id,
    recipeGeneration: buildGenerationPin({ idea: pin.idea, sourceIds: pin.sourceIds ?? [], instructions: pin.instructions }, { tryCount: pin.tryCount + 1, generationId: pin.generationId ?? run._id, feedback: reasons.join("\n") }),
  });
  await ctx.db.patch(runId, { sessionKey: `mega-run-${runId}` });
}

/** What makes a proposal unacceptable beyond its shape: its target and the Sources it cites. */
async function proposalProblems(ctx: MutationCtx, run: Doc<"runs">, given: readonly Id<"sources">[], proposal: { templateId: string; missionType: string; sourceIds: string[]}): Promise<string[]> {
  const problems: string[] = [];
  try {
    await requireValidTarget(ctx, run.instanceId, proposal.templateId, proposal.missionType);
  } catch (error) {
    problems.push(`target: ${error instanceof Error ? error.message : String(error)}`);
  }
  const cited = [...new Set(proposal.sourceIds)];
  const documents = await Promise.all(
    cited.map((raw) => {
      const id = ctx.db.normalizeId("sources", raw);
      return id ? ctx.db.get(id) : null;
    }),
  );
  const givenIds = new Set<string>(given);
  cited.forEach((raw, i) => {
    const source = documents[i];
    if (!source || source.instanceId !== run.instanceId || source.ownerId !== run.ownerId) problems.push(`sourceIds: ${raw} is not a Source of this Project`);
    else if (!givenIds.has(source._id)) problems.push(`sourceIds: ${raw} is not among the Sources of this generation`);
    else if (!isReadableSource(source)) problems.push(`sourceIds: ${raw} is not a ready, non-excluded Source`);
  });
  return problems;
}

/**
 * The result file of a Recipe Generation Run (an envelope): validated as a whole, then stored on the Run as
 * `{ proposal }` or `{ no_opportunity }`. An invalid result fails the Run, stores nothing and, within the tries budget,
 * starts a new Run with the reasons. A Run already settled is left as it is.
 */
export async function settleRecipeGenerationRun(ctx: MutationCtx, run: Doc<"runs">, result: RunResult, envelope: unknown): Promise<void> {
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
  if (!("recipeGeneration" in run) || !run.recipeGeneration) return;
  const now = Date.now();
  const parsed = envelope === undefined ? ({ ok: false, errors: ["The Run returned no Recipe Generation result."] as string[] } as const) : parseRecipeResult(envelope);
  const errors = parsed.ok && parsed.kind === "proposal"
    ? await proposalProblems(ctx, run, run.recipeGeneration.sourceIds ?? [], parsed.proposal)
    : parsed.ok ? [] : parsed.errors;
  if (!parsed.ok || errors.length > 0) {
    await ctx.db.patch(run._id, { status: "failed", errorMessage: `invalid_result: ${errors.join(" ")}`, completedAt: now, updatedAt: now });
    await failRecipeGenerationRun(ctx, run, errors);
    return;
  }
  const recipeProposal = parsed.kind === "proposal"
    ? { proposal: parsed.proposal }
    : { no_opportunity: { reason: parsed.reason, ...(parsed.details ? { details: parsed.details } : {}) } };
  await ctx.db.patch(run._id, { status: "completed", result, recipeProposal, completedAt: now, updatedAt: now });
}

export const isRecipeGenerationRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run !== null && "recipeGeneration" in run && run.recipeGeneration !== undefined;
  },
});

/** What dispatching a Recipe Generation Run needs; everything comes from the Run's pin. */
export const loadDispatchInputs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !("recipeGeneration" in run) || !run.recipeGeneration) return null;
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", run.instanceId).eq("templateId", run.templateId))
      .unique();
    if (!agent?.workspaceKey) return null;
    return {
      run: { _id: run._id, agentName: run.agentName, sessionKey: run.sessionKey },
      workspaceKey: agent.workspaceKey,
      instanceId: run.instanceId,
      templateId: run.templateId,
      runFile: buildRecipeGenerationRunFile({ idea: run.recipeGeneration.idea, sourceCount: run.recipeGeneration.sourceIds?.length ?? 0, instructions: run.recipeGeneration.instructions, feedback: run.recipeGeneration.feedback }),
    };
  },
});
