import { v, type ObjectType } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { REFERENCE_KEYS, normalizeMemory, parseEnvelope, type ReferenceKey } from "./strategic_review_rules.js";

// Persistence of Strategic Reviews (ADR-085, issue #164). Rows are immutable:
// this module deliberately has no update, delete or purge function. Callers
// (the Run result handler, the Internal MCP read tool, the dispatcher pins)
// pass the Project's `instanceId`, taken from the Run or the token, never from
// the Agent.

export type PersistResult =
  | { ok: true; reviewId: Id<"strategicReviews">; created: boolean; memoryChanged: boolean }
  | { ok: false; reason: "invalid_result" | "invalid_references" | "memory_conflict"; message: string };

const reject = (reason: Extract<PersistResult, { ok: false }>["reason"], message: string): PersistResult => ({ ok: false, reason, message });

const REFERENCE_TABLES = { familyIds: "creativeFamilies", recipeIds: "productionRecipes", publicationIds: "publications" } as const;

/** The latest persisted Review of a Project, the current Strategic Memory. */
export async function latestOf(ctx: QueryCtx, instanceId: string): Promise<Doc<"strategicReviews"> | null> {
  return await ctx.db.query("strategicReviews").withIndex("by_instance_created", (q) => q.eq("instanceId", instanceId)).order("desc").first();
}

/** One Review of a Project; null when it does not exist or belongs to another Project. */
async function reviewOf(ctx: QueryCtx, instanceId: string, reviewId: Id<"strategicReviews">): Promise<Doc<"strategicReviews"> | null> {
  const review = await ctx.db.get(reviewId);
  return review && review.instanceId === instanceId ? review : null;
}

/**
 * What `get_strategic_memory` serves: a Review without its Performance Report
 * (the report is never exposed to an Agent), or an explicit "none yet".
 */
export type StrategicMemoryReading =
  | { exists: false; message: string }
  | { exists: true; reviewId: Id<"strategicReviews">; periodStart: number; periodEnd: number; memory: string; references: Doc<"strategicReviews">["references"]; createdAt: number };

/** The pins of the strategic_review Run this Agent is running, if it has one (the token carries no Run). */
async function pinsOfRunningStrategicReview(ctx: QueryCtx, instanceId: string, templateId: string): Promise<NonNullable<Doc<"runs">["strategicReview"]> | undefined> {
  const running = await ctx.db
    .query("runs")
    .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", "running"))
    .take(20);
  for (const run of running) {
    if (run.strategicReview === undefined || !("jobId" in run) || run.jobId === undefined) continue;
    // Only a Run whose parent is a strategic_review Job is pinned.
    const job = await ctx.db.get(run.jobId);
    if (job?.type === "strategic_review") return run.strategicReview;
  }
  return undefined;
}

/**
 * The Strategic Memory an Agent of this Project reads. A Run of the Agent that
 * is a running `strategic_review` Run is served the base it was dispatched with
 * (its `baseReviewId`, through `reviewOf`), even if a newer Review landed since;
 * every other reader gets the latest Review.
 */
export async function readStrategicMemory(ctx: QueryCtx, scope: { instanceId: string; templateId?: string }): Promise<StrategicMemoryReading> {
  const pins = scope.templateId === undefined ? undefined : await pinsOfRunningStrategicReview(ctx, scope.instanceId, scope.templateId);
  // A Run pinned without a base reads no memory.
  const review = pins ? (pins.baseReviewId ? await reviewOf(ctx, scope.instanceId, pins.baseReviewId) : null) : await latestOf(ctx, scope.instanceId);
  if (!review) return { exists: false, message: "No Strategic Review exists for this Project yet: there is no Strategic Memory." };
  return { exists: true, reviewId: review._id, periodStart: review.periodStart, periodEnd: review.periodEnd, memory: review.consolidatedMemory, references: review.references, createdAt: review.createdAt };
}

/** The ids that do not resolve to an entity of this Project, unless the base already held them. */
async function unknownReferences(ctx: QueryCtx, instanceId: string, ids: string[], key: ReferenceKey, held: Set<string>) {
  const table = REFERENCE_TABLES[key];
  const bad: string[] = [];
  const good: string[] = [];
  for (const id of ids) {
    if (held.has(id)) {
      good.push(id);
      continue;
    }
    const normalized = ctx.db.normalizeId(table, id);
    const doc = normalized ? await ctx.db.get(normalized) : null;
    // Archived entities are valid; only a missing or foreign one is refused.
    if (doc && "instanceId" in doc && doc.instanceId === instanceId) good.push(id);
    else bad.push(id);
  }
  return { bad, good };
}

const persistArgs = {
  instanceId: v.string(),
  runId: v.id("runs"),
  baseReviewId: v.optional(v.id("strategicReviews")),
  periodStart: v.number(),
  periodEnd: v.number(),
  envelope: v.any(),
};
export type PersistArgs = ObjectType<typeof persistArgs>;

/**
 * Validates an Agent's result envelope and persists it as the Project's next
 * Strategic Review, in one atomic mutation: (1) the Review already persisted
 * for this Run is returned (idempotent retry), (2) a base that is not the
 * Project's latest Review is a memory conflict, (3) the Review is inserted.
 * Nothing is written on a rejection. `periodStart`, `periodEnd` and
 * `baseReviewId` are the values pinned at dispatch, never read from the envelope.
 */
export const persist = internalMutation({
  args: persistArgs,
  handler: async (ctx: MutationCtx, args): Promise<PersistResult> => await persistStrategicReview(ctx, args),
});

/** The persistence itself, callable from another mutation (the Run result handler) in its own transaction. */
export async function persistStrategicReview(ctx: MutationCtx, args: PersistArgs): Promise<PersistResult> {
  const run = await ctx.db.get(args.runId);
  if (!run || run.instanceId !== args.instanceId) return reject("invalid_result", "The Run does not belong to this Project.");

  const existing = await ctx.db.query("strategicReviews").withIndex("by_instance_run", (q) => q.eq("instanceId", args.instanceId).eq("runId", args.runId)).first();
  if (existing) return { ok: true, reviewId: existing._id, created: false, memoryChanged: existing.memoryChanged };

  const parsed = parseEnvelope(args.envelope);
  if (!parsed.ok) return reject("invalid_result", parsed.message);

  const latest = await latestOf(ctx, args.instanceId);
  if ((latest?._id ?? null) !== (args.baseReviewId ?? null)) {
    return reject("memory_conflict", "Another Strategic Review was persisted since this Run started; its memory was not based on the latest one.");
  }

  const { report, consolidatedMemory, references: requested } = parsed.value;
  const refs = {} as Record<ReferenceKey, string[]>;
  const problems: string[] = [];
  for (const key of REFERENCE_KEYS) {
    const held = new Set<string>(latest?.references[key] ?? []);
    const { bad, good } = await unknownReferences(ctx, args.instanceId, requested[key], key, held);
    refs[key] = good;
    if (bad.length > 0) problems.push(`${key}: ${bad.join(", ")}`);
  }
  if (problems.length > 0) return reject("invalid_references", `Unknown or foreign references (${problems.join("; ")}).`);

  const memoryChanged = normalizeMemory(consolidatedMemory) !== normalizeMemory(latest?.consolidatedMemory ?? "");
  const reviewId = await ctx.db.insert("strategicReviews", {
    ownerId: run.ownerId,
    instanceId: args.instanceId,
    runId: args.runId,
    ...(latest ? { baseReviewId: latest._id } : {}),
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    report,
    consolidatedMemory,
    references: {
      familyIds: refs.familyIds as Id<"creativeFamilies">[],
      recipeIds: refs.recipeIds as Id<"productionRecipes">[],
      publicationIds: refs.publicationIds as Id<"publications">[],
    },
    memoryChanged,
    createdAt: Date.now(),
  });
  return { ok: true, reviewId, created: true, memoryChanged };
}

/** The Project's current Strategic Review (its latest), or null before the first one. */
export const latestByInstance = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => await latestOf(ctx, args.instanceId),
});

/** One Review of a Project (the base pinned on a Run); null when it belongs to another Project. */
export const getById = internalQuery({
  args: { instanceId: v.string(), reviewId: v.id("strategicReviews") },
  handler: async (ctx, args) => await reviewOf(ctx, args.instanceId, args.reviewId),
});
