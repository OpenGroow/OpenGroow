import { paginationOptsValidator } from "convex/server";
import type { SourcePlatformDeclaration } from "@opengroow/agent-templates";
import { v, type ObjectType } from "convex/values";
import { resolveSource } from "./source_enrichment.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { readOwnerId, requireOwnedRow } from "./instance_ownership.js";
import { sourceMarketingV } from "./source_schema.js";
import { originKeyOf } from "./source_origin.js";
import { declaredPlatformOf } from "./source_platform.js";

/** A Source's thumbnail is a stored file: the URL a page can load, or null. */
async function thumbnailUrlOf(ctx: Pick<QueryCtx, "storage">, source: Doc<"sources">): Promise<string | null> {
  return source.thumbnailStorageId ? await ctx.storage.getUrl(source.thumbnailStorageId) : null;
}

/** Deletes a Source and the thumbnail file it owns. */
export async function deleteSource(ctx: MutationCtx, source: Doc<"sources">): Promise<void> {
  if (source.thumbnailStorageId) await ctx.storage.delete(source.thumbnailStorageId);
  await ctx.db.delete(source._id);
}

const insertArgs = {
  instanceId: v.string(),
  ownerId: v.string(),
  templateId: v.string(),
  sourceId: v.string(),
  label: v.string(),
  family: v.string(),
  // Narrower than the table's `sourceStatusV` on purpose: a write can only
  // produce `processing` or `ready`; `failed` and `unavailable` belong to the
  // enrichment polling that completes a Source.
  status: v.union(v.literal("processing"), v.literal("ready")),
  origin: v.string(),
  capturedAt: v.number(),
  marketing: sourceMarketingV,
  raw: v.optional(v.string()),
  analysis: v.any(),
  // Provenance, taken from the Run the ingestion belongs to.
  runId: v.optional(v.id("runs")),
  sourceJobId: v.optional(v.id("jobs")),
};

// Sources are append-only (ADR-051): the only write is an insert. Validation
// and the declared label/family/status are resolved by the caller (the
// ingestion of a SourceJob result, `source_jobs/ingest_sources.ts`).
export async function insertSource(ctx: MutationCtx, args: ObjectType<typeof insertArgs>, platform?: SourcePlatformDeclaration) {
  const originKey = originKeyOf(args.origin, platform);
  return await ctx.db.insert("sources", { ...args, ...(originKey !== undefined ? { originKey } : {}), createdAt: Date.now() });
}

export const insert = internalMutation({
  args: insertArgs,
  handler: async (ctx, args) => await insertSource(ctx, args, await declaredPlatformOf(ctx, args)),
});

const completeArgs = {
  id: v.string(),
  instanceId: v.string(),
  templateId: v.string(),
  sourceId: v.string(),
  origin: v.string(),
  capturedAt: v.number(),
  marketing: sourceMarketingV,
  raw: v.optional(v.string()),
  analysis: v.any(),
};

export const complete = internalMutation({
  args: completeArgs,
  handler: async (ctx, args) => await completeSource(ctx, args, await declaredPlatformOf(ctx, args)),
});

/**
 * The enrichment phase's second write (issue #533): the resumed SourceJob
 * execution completes a `processing` Source with its normalized payload, which
 * leaves it `ready`. The only mutation of a Source's content — every other
 * write appends. Resolves the Agent-supplied `id`; returns the reason instead
 * of throwing so the caller can hand it back to the Agent as a validation error.
 */
export async function completeSource(
  ctx: MutationCtx,
  args: ObjectType<typeof completeArgs>,
  platform?: SourcePlatformDeclaration,
): Promise<{ ok: true; id: Id<"sources"> } | { ok: false; error: string }> {
  const docId = ctx.db.normalizeId("sources", args.id);
  const source = docId ? await ctx.db.get(docId) : null;
  if (!docId || !source || source.instanceId !== args.instanceId || source.templateId !== args.templateId) {
    return { ok: false, error: `id: no Source "${args.id}" for this Agent` };
  }
  if (source.sourceId !== args.sourceId) {
    return { ok: false, error: `sourceId: Source "${args.id}" is a "${source.sourceId}" Source, not "${args.sourceId}"` };
  }
  if (source.status !== "processing") {
    return { ok: false, error: `id: Source "${args.id}" is ${source.status}, only a processing Source can be completed` };
  }
  const originKey = originKeyOf(args.origin, platform);
  await ctx.db.patch(docId, {
    status: "ready",
    origin: args.origin,
    originKey,
    capturedAt: args.capturedAt,
    marketing: args.marketing,
    ...(args.raw !== undefined ? { raw: args.raw } : {}),
    analysis: args.analysis,
  });
  return { ok: true, id: docId };
}

/**
 * The Source a handed-off enrichment job names (`job.sourceRef`, supplied by
 * the Agent): `null` unless it is a row of this Agent.
 */
export const getForEnrichment = internalQuery({
  args: { sourceRef: v.string(), instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sources", args.sourceRef);
    const source = id ? await ctx.db.get(id) : null;
    if (!source || source.instanceId !== args.instanceId || source.templateId !== args.templateId) return null;
    return { _id: source._id, sourceId: source.sourceId, status: source.status };
  },
});

// A Template declares a handful of families; this only bounds the walk.
const MAX_FAMILIES = 100;

/**
 * Recent Sources of every Agent in a Project, most-recently-added first,
 * paginated by cursor. Ownership-scoped like `observations.listByInstance`
 * (an empty finished page for a stranger or an unowned instance). Ownership
 * and the optional family filter are both served by indexes, never a
 * `.filter()` (`_generated/ai/guidelines.md`, "Query guidelines").
 */
export const listByInstance = query({
  args: { instanceId: v.string(), family: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return { page: [], isDone: true, continueCursor: "" };
    const { family } = args;
    const result =
      family !== undefined
        ? await ctx.db
            .query("sources")
            .withIndex("by_instance_owner_family_createdAt", (q) =>
              q.eq("instanceId", args.instanceId).eq("ownerId", ownerId).eq("family", family),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("sources")
            .withIndex("by_instance_owner_createdAt", (q) => q.eq("instanceId", args.instanceId).eq("ownerId", ownerId))
            .order("desc")
            .paginate(args.paginationOpts);
    // The thumbnail is stored as a file: hand the page a URL it can load.
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (source) => ({ ...source, thumbnailUrl: await thumbnailUrlOf(ctx, source) })),
      ),
    };
  },
});

/** The most Sources of one status `counts` reads. */
export const COUNT_CAP = 5000;

/**
 * The real number of Sources of an Instance (the Sources page's tiles and tab
 * counts), not the number loaded so far. Convex has no `count()`, so each status
 * is read through its index, at most `COUNT_CAP` rows; `capped` says a status
 * had more. `scored` and `other` are the two tabs (the Scored stage, and what is
 * neither Scored nor picked for production).
 */
export const counts = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const out = { total: 0, processing: 0, ready: 0, failed: 0, unavailable: 0, scored: 0, other: 0, capped: false };
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return out;
    for (const status of ["processing", "ready", "failed", "unavailable"] as const) {
      const rows = await ctx.db
        .query("sources")
        .withIndex("by_instance_status_capturedAt", (q) => q.eq("instanceId", args.instanceId).eq("status", status))
        .take(COUNT_CAP + 1);
      if (rows.length > COUNT_CAP) out.capped = true;
      for (const source of rows.slice(0, COUNT_CAP)) {
        if (source.ownerId !== ownerId) continue;
        out[status] += 1;
        out.total += 1;
        const analysed = status === "ready" && source.excluded !== true && source.scoring !== undefined;
        if (!analysed) out.other += 1;
        else if (source.selectedAt === undefined) out.scored += 1;
      }
    }
    return out;
  },
});

/**
 * Distinct families of the caller's Sources in a Project, sorted — the filter
 * chips of the Sources page. Walks the family index one family at a time
 * (skip to the first row after the last family seen), so the cost is bounded
 * by the number of families, not of Sources.
 */
export const listFamilies = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    const families: string[] = [];
    while (families.length < MAX_FAMILIES) {
      const last = families.at(-1);
      const next = await ctx.db
        .query("sources")
        .withIndex("by_instance_owner_family_createdAt", (q) => {
          const owned = q.eq("instanceId", args.instanceId).eq("ownerId", ownerId);
          return last === undefined ? owned : owned.gt("family", last);
        })
        .first();
      if (next === null) break;
      families.push(next.family);
    }
    return families;
  },
});

/**
 * One Source for its owner, with the analysis JSON Schema its Template
 * declared (the detail page renders `analysis` from it: titles become
 * labels). `analysisSchema` is `null` when the Template is gone or no longer
 * declares the Source; the page then falls back to humanized keys.
 */
export const get = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) return null;
    const ownerId = await readOwnerId(ctx, source.instanceId);
    if (ownerId === null || ownerId !== source.ownerId) return null;
    const declaration = (await resolveSource(ctx, source.instanceId, source.templateId, source.sourceId))?.declaration;
    // The Run link of the detail page targets the Agent's workspace logs.
    const agent = await ctx.db
      .query("projectAgents")
      .withIndex("by_instance_template", (q) =>
        q.eq("instanceId", source.instanceId).eq("templateId", source.templateId),
      )
      .unique();
    return {
      source,
      analysisSchema: declaration?.analysisSchema ?? null,
      workspaceKey: agent?.workspaceKey ?? null,
      thumbnailUrl: await thumbnailUrlOf(ctx, source),
    };
  },
});

/**
 * Manual retry of a `failed` Source: puts it back to `processing`, which is
 * what the page shows until something re-attempts it. Never applies to
 * `unavailable` (the Source is structurally unanalyzable) nor to any other
 * status.
 *
 * It also flags the Source (`retryRequested`) so it joins the Agent's next
 * SourceJob batch regardless of the cursor; the flag is cleared when a batch
 * containing it succeeds (`source_jobs.settleSourceJobRun`).
 */
export const retry = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) throw new Error("Source not found");
    await requireOwnedRow(ctx, source);
    if (source.status !== "failed") throw new Error("Only a failed Source can be retried");
    await ctx.db.patch(args.sourceId, { status: "processing", retryRequested: true });
  },
});

/** Upper bound of one `removeMany` call: a single mutation stays well inside Convex's limits. */
export const MAX_SOURCES_PER_REMOVAL = 100;

/**
 * Permanently deletes Sources the caller owns (the Sources page's select mode).
 * Anything that points at a deleted Source keeps working: a Mission created
 * from it keeps its `sourceObservationId` but nothing reads it back. A Source
 * still `processing` may have an enrichment in flight; its result is then
 * rejected as "Source not found" instead of resurrecting the row. The same
 * post can be ingested again later as a new Source.
 *
 * Ids that no longer exist are skipped (a double click, two tabs); an id the
 * caller does not own rejects the whole call before anything is deleted.
 */
export const removeMany = mutation({
  args: { sourceIds: v.array(v.id("sources")) },
  handler: async (ctx, args) => {
    const ids = [...new Set(args.sourceIds)];
    if (ids.length > MAX_SOURCES_PER_REMOVAL) {
      throw new Error(`At most ${MAX_SOURCES_PER_REMOVAL} Sources can be deleted at once`);
    }
    const owned: Doc<"sources">[] = [];
    for (const id of ids) {
      const source = await ctx.db.get(id);
      if (!source) continue;
      await requireOwnedRow(ctx, source);
      owned.push(source);
    }
    for (const source of owned) await deleteSource(ctx, source);
    return { removed: owned.length };
  },
});
