import { v } from "convex/values";
import { DEFAULT_COLLECT_DELAYS_MS, metricKindOf } from "@opengroow/publisher-sdk";
import type { Doc } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server.js";
import { installedAnalyticsAdapters, linkedAdapter } from "./analytics_adapters.js";
import { readOwnerId } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";

// Performance Snapshots (ADR-078, docs/domain/publishing.md): when a
// Publication becomes `published`, its readings are scheduled and the core
// takes them through the Analytics Adapter. A reading never changes the
// Publication.

/** A reading that found nothing yet, or failed, is asked again after this. */
export const RETRY_AFTER_MS = 60 * 60_000;

/** Called when a Publication becomes `published`: schedules its readings, once. */
export async function scheduleReadings(ctx: MutationCtx, publication: Doc<"publications">): Promise<void> {
  const postSeries = publication.postSeries ?? 0;
  const rows = await ctx.db
    .query("publicationAnalytics")
    .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
    .collect();
  if (rows.some((row) => row.postSeries === postSeries)) return;
  // A retry that created a new post: the old post is no longer measured, its Snapshots stay.
  for (const row of rows) if (!row.done) await ctx.db.patch(row._id, { done: true, updatedAt: Date.now() });
  const publishers = await projectPublishers(ctx, publication.instanceId);
  const publisherAdapter = publication.attemptContext?.adapter ?? channelOf(publishers, publication.target)?.publisher.adapter;
  if (!publisherAdapter) return;
  const publishedAt = Date.now();
  await ctx.db.insert("publicationAnalytics", {
    publicationId: publication._id,
    postSeries,
    instanceId: publication.instanceId,
    publisherAdapter,
    publishedAt,
    delays: DEFAULT_COLLECT_DELAYS_MS,
    taken: 0,
    state: "waiting",
    nextAt: publishedAt + DEFAULT_COLLECT_DELAYS_MS[0],
    done: false,
    updatedAt: publishedAt,
  });
}

/** The readings of a Publication: the state of its current post's series, why, when the next one is due, and all its Snapshots (oldest first, each with its `postSeries`). */
export const forPublication = query({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication || !(await readOwnerId(ctx, publication.instanceId))) return null;
    const row = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_publication_and_series", (q) => q.eq("publicationId", args.publicationId).eq("postSeries", publication.postSeries ?? 0))
      .unique();
    const snapshots = await ctx.db
      .query("performanceSnapshots")
      .withIndex("by_publication", (q) => q.eq("publicationId", args.publicationId))
      .collect();
    return {
      state: row?.state ?? ("unmeasured" as const),
      ...(row?.reason ? { reason: row.reason } : {}),
      ...(row && !row.done ? { nextAt: row.nextAt } : {}),
      snapshots: snapshots
        .sort((a, b) => a.takenAt - b.takenAt)
        .map((s) => ({ postSeries: s.postSeries, delayMs: s.delayMs, takenAt: s.takenAt, metrics: s.metrics, source: s.source })),
    };
  },
});

/** Readings due now, with what the adapter needs to take them. */
export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_done_and_next", (q) => q.eq("done", false).lte("nextAt", args.now))
      .take(100);
    const adapters = await installedAnalyticsAdapters(ctx);
    const out = [];
    for (const row of rows) {
      const publication = await ctx.db.get(row.publicationId);
      if (!publication) continue;
      // The adapter is the one the channel is linked to now (ADR-078): none reads "analytics unavailable".
      const found = channelOf(await projectPublishers(ctx, row.instanceId), publication.target);
      const link = found ? linkedAdapter(adapters, found.publisher.adapter, found.channel.analyticsAdapter) : null;
      // An adapter of the Publisher's own service reads with the Publisher's connection.
      const publisher = found && link?.adapter.publisher === found.publisher.adapter ? found.publisher : undefined;
      out.push({
        id: row._id,
        analyticsAdapter: link?.adapter.id ?? null,
        publishedAt: row.publishedAt,
        delayMs: row.delays[row.taken],
        kind: metricKindOf(publication.attemptContext?.publishable?.kind as string | undefined),
        externalId: publication.externalId,
        externalUrl: publication.externalUrl,
        ...(publisher?.apiKey ? { connection: { url: publisher.url, apiKey: publisher.apiKey } } : {}),
      });
    }
    return out;
  },
});

export const outcomeV = v.union(
  v.object({ kind: v.literal("taken"), metrics: v.record(v.string(), v.number()) }),
  v.object({ kind: v.literal("no_data") }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
  v.object({ kind: v.literal("post_unknown"), reason: v.string() }),
  // Not due yet (the adapter reports later than the Template asked) or its key is missing: no reading tried.
  v.object({ kind: v.literal("postponed"), nextAt: v.number() }),
  v.object({ kind: v.literal("unmeasured") }),
);

/** Records the outcome of one reading. Never touches the Publication. */
export const record = internalMutation({
  args: { id: v.id("publicationAnalytics"), outcome: outcomeV },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.done) return;
    const now = Date.now();
    const { outcome } = args;
    switch (outcome.kind) {
      case "taken": {
        await ctx.db.insert("performanceSnapshots", {
          publicationId: row.publicationId,
          postSeries: row.postSeries,
          instanceId: row.instanceId,
          delayMs: row.delays[row.taken],
          takenAt: now,
          metrics: outcome.metrics,
          source: "adapter",
        });
        const taken = row.taken + 1;
        const complete = taken >= row.delays.length;
        await ctx.db.patch(row._id, {
          taken,
          state: complete ? "complete" : "waiting",
          reason: undefined,
          done: complete,
          nextAt: complete ? row.nextAt : row.publishedAt + row.delays[taken],
          updatedAt: now,
        });
        return;
      }
      case "no_data":
        await ctx.db.patch(row._id, { state: "no_data", reason: undefined, nextAt: now + RETRY_AFTER_MS, updatedAt: now });
        return;
      case "failed":
        await ctx.db.patch(row._id, { state: "failed", reason: outcome.error, nextAt: now + RETRY_AFTER_MS, updatedAt: now });
        return;
      case "post_unknown":
        await ctx.db.patch(row._id, { state: "post_unknown", reason: outcome.reason, done: true, updatedAt: now });
        return;
      case "postponed":
        await ctx.db.patch(row._id, { nextAt: outcome.nextAt, updatedAt: now });
        return;
      case "unmeasured":
        await ctx.db.patch(row._id, { state: "unmeasured", done: true, updatedAt: now });
        return;
    }
  },
});
