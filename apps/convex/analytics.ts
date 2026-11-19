import { v, type Infer } from "convex/values";
import { metricKindOf } from "@opengroow/publisher-sdk";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { installedAnalyticsAdapters, linkedAdapter } from "./analytics_adapters.js";
import { connectionFor, projectAnalyticsConnection } from "./analytics_connections.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";
import { getTemplateRegistry } from "./template_registry.js";
import { analyticsDeclarationFor } from "@opengroow/agent-templates";
import { publishableOf } from "./publications.js";
import { publishableForPlatform } from "./publishable.js";

// Performance Snapshots (ADR-078, docs/domain/publishing.md): when a
// Publication becomes `published`, its readings are scheduled and the core
// takes them through the Analytics Adapter. A reading never changes the
// Publication.

/** A reading that found nothing yet, or failed, is asked again after this. */
export const RETRY_AFTER_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Called when a Publication becomes `published`: schedules its readings, once.
 * `backfill`: a Publication published before it was measured (or before its Mission type declared
 * `analytics`): its delays count from when it was published, only the ones still to come are
 * scheduled, so no reading is recorded under a delay it does not stand for.
 */
export async function scheduleReadings(ctx: MutationCtx, publication: Doc<"publications">, options: { backfill?: boolean } = {}): Promise<void> {
  // Only a Mission type that declares `analytics` is measured (ADR-078): none, no reading.
  const mission = await ctx.db.get(publication.missionId);
  if (!mission) return;
  const template = await getTemplateRegistry(ctx).resolve(publication.instanceId, mission.templateId, mission.templateVersion);
  const declaration = analyticsDeclarationFor(template?.manifest, mission.type);
  if (!declaration) return;
  const now = Date.now();
  const publishedAt = options.backfill ? publication.updatedAt : now;
  const all = declaration.collect.map((days) => days * DAY_MS);
  const delays = options.backfill ? all.filter((delay) => publishedAt + delay > now) : all;
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
  // Nothing left to schedule: the post is old enough that only a refresh reads it.
  const finished = delays.length === 0;
  await ctx.db.insert("publicationAnalytics", {
    publicationId: publication._id,
    postSeries,
    instanceId: publication.instanceId,
    publisherAdapter,
    publishedAt,
    delays,
    taken: 0,
    state: finished ? "no_data" : "waiting",
    nextAt: publishedAt + (delays[0] ?? 0),
    done: finished,
    updatedAt: now,
  });
}

/** Gives the Publications of a Project that were published before they were measured the rows of their readings. */
export const backfill = internalMutation({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const published = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("desc")
      .take(LIST_LIMIT);
    for (const publication of published) await scheduleReadings(ctx, publication, { backfill: true });
  },
});

/** Snapshots oldest first, as the pages read them. */
function snapshotView(rows: Doc<"performanceSnapshots">[]) {
  return [...rows]
    .sort((a, b) => a.takenAt - b.takenAt)
    .map((s) => ({ postSeries: s.postSeries, delayMs: s.delayMs, takenAt: s.takenAt, metrics: s.metrics, source: s.source }));
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
      snapshots: snapshotView(snapshots),
    };
  },
});

const httpUrl = (value: unknown) => (typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined);

/** What the Analytics page shows of the post: its title, its kind and an image to recognise it by. */
function postFace(mission: Doc<"missions">, platform: string | undefined) {
  const base = publishableOf(mission);
  const served = base ? publishableForPlatform(base, platform) : undefined;
  const p = served?.ok ? served.publishable : base;
  const slides = Array.isArray(p?.slideUrls) ? httpUrl(p.slideUrls[0]) : undefined;
  const thumbnailUrl = httpUrl(p?.coverUrl) ?? httpUrl(p?.imageUrl) ?? slides;
  return {
    ...(typeof p?.title === "string" && p.title.trim() ? { title: p.title.trim() } : {}),
    ...(typeof p?.kind === "string" ? { kind: p.kind } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    // A video with no cover: the page shows its first frame.
    ...(!thumbnailUrl && p?.kind === "video" && httpUrl(p.videoUrl) ? { videoUrl: httpUrl(p.videoUrl) } : {}),
  };
}

/** The most Publications the Analytics page lists (newest first). */
const LIST_LIMIT = 200;

/**
 * The Analytics page's rows: a Project's published Publications with their
 * platform, channel, Mission, Source of origin, the Mission type's primary
 * metric (what the page ranks by, within one platform) and their readings.
 * Never a per-Mission total: each row is one Publication (ADR-078).
 */
export const listForProject = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("desc")
      .take(LIST_LIMIT);
    const publishers = await projectPublishers(ctx, args.instanceId);
    const registry = getTemplateRegistry(ctx);
    const rows = [];
    for (const publication of publications) {
      const mission = await ctx.db.get(publication.missionId);
      if (!mission) continue;
      const found = channelOf(publishers, publication.target);
      const series = publication.postSeries ?? 0;
      const row = await ctx.db
        .query("publicationAnalytics")
        .withIndex("by_publication_and_series", (q) => q.eq("publicationId", publication._id).eq("postSeries", series))
        .unique();
      // A channel with no Analytics Adapter is not measured: nothing to show for it.
      if (!row || row.state === "unmeasured") continue;
      const snapshots = await ctx.db
        .query("performanceSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
        .collect();
      const template = await registry.resolve(args.instanceId, mission.templateId, mission.templateVersion);
      const primaryMetric = analyticsDeclarationFor(template?.manifest, mission.type)?.primaryMetric;
      const platform = found?.channel.channelService ?? publication.target.split(":")[0];
      const face = postFace(mission, platform);
      rows.push({
        ...face,
        publishedAt: row.publishedAt,
        publicationId: publication._id,
        missionId: mission._id,
        missionName: mission.name ?? mission.summary ?? (mission.number !== undefined ? `Mission #${mission.number}` : "Mission"),
        missionType: mission.type,
        target: publication.target,
        platform,
        ...(found?.channel.channelName ? { channelName: found.channel.channelName } : {}),
        ...(found?.channel.channelProfile ? { channelProfile: found.channel.channelProfile } : {}),
        ...(found ? { publisherAdapter: found.publisher.adapter } : {}),
        ...(publication.externalUrl ? { externalUrl: publication.externalUrl } : {}),
        ...(primaryMetric ? { primaryMetric } : {}),
        state: row.state,
        ...(row.reason ? { reason: row.reason } : {}),
        ...(!row.done ? { nextAt: row.nextAt } : {}),
        snapshots: snapshotView(snapshots),
      });
    }
    return rows;
  },
});

/**
 * What the Analytics page builds its columns, tiles and ranking from (ADR-079): the metrics
 * and the ranking metric of the Analytics Adapter the Project's published posts are linked to.
 * The first linked adapter that declares its metrics (contract 2); null when none does, and the
 * page then falls back to the closed social vocabulary of contract 1.
 */
export const declarationForProject = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return null;
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("asc")
      .take(LIST_LIMIT);
    const installed = await installedAnalyticsAdapters(ctx);
    const publishers = await projectPublishers(ctx, args.instanceId);
    for (const publication of publications) {
      const found = channelOf(publishers, publication.target);
      const link = found ? linkedAdapter(installed, found.publisher.adapter, found.channel.analyticsAdapter) : null;
      const adapter = link?.adapter;
      if (adapter?.metrics && adapter.primary) return { adapter: adapter.id, name: adapter.name, metrics: adapter.metrics, primary: adapter.primary };
    }
    return null;
  },
});

async function insertSnapshot(
  ctx: MutationCtx,
  row: Doc<"publicationAnalytics">,
  snapshot: { delayMs: number; takenAt: number; metrics: Record<string, number>; source: "adapter" | "refresh" },
) {
  await ctx.db.insert("performanceSnapshots", {
    publicationId: row.publicationId,
    postSeries: row.postSeries,
    instanceId: row.instanceId,
    ...snapshot,
  });
}

type ReadingRow = Doc<"publicationAnalytics">;

/** What an adapter needs to take the reading of one Publication (its channel's adapter and connection). */
async function readingItem(ctx: Pick<QueryCtx, "db">, row: ReadingRow, adapters: Awaited<ReturnType<typeof installedAnalyticsAdapters>>, delayMs: number) {
  const publication = await ctx.db.get(row.publicationId);
  if (!publication) return null;
  // The adapter is the one the channel is linked to now (ADR-078): none reads "analytics unavailable".
  const found = channelOf(await projectPublishers(ctx, row.instanceId), publication.target);
  const link = found ? linkedAdapter(adapters, found.publisher.adapter, found.channel.analyticsAdapter) : null;
  // The Project's own connection to the adapter, else (for the adapter of the Publisher's own service) the Publisher's.
  const publisher = found && link?.adapter.publisher === found.publisher.adapter ? found.publisher : undefined;
  const connection = link ? connectionFor(await projectAnalyticsConnection(ctx, row.instanceId, link.adapter.id), publisher) : undefined;
  return {
    id: row._id,
    analyticsAdapter: link?.adapter.id ?? null,
    // Contract 2: the metrics the adapter declares (ADR-079); absent for contract 1, which keeps the closed vocabulary.
    ...(link?.adapter.metrics ? { declaredMetrics: link.adapter.metrics } : {}),
    publishedAt: row.publishedAt,
    delayMs,
    kind: metricKindOf(publication.attemptContext?.publishable?.kind as string | undefined),
    externalId: publication.externalId,
    externalUrl: publication.externalUrl,
    ...(connection ? { connection } : {}),
  };
}

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
      const item = await readingItem(ctx, row, adapters, row.delays[row.taken]);
      if (item) out.push(item);
    }
    return out;
  },
});

/** The most posts a refresh reads. */
const REFRESH_LIMIT = 100;

/**
 * Every measured post of a Project, to read again now: what "Refresh" on the Analytics page takes,
 * whatever their schedule. Only the adapter's own earliest delay holds a reading back (`delayMs` 0).
 */
export const forRefresh = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const rows = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(REFRESH_LIMIT);
    const adapters = await installedAnalyticsAdapters(ctx);
    const out = [];
    for (const row of rows) {
      // The post of the Publication's current series, and not one whose post the service does not know.
      const publication = await ctx.db.get(row.publicationId);
      if (!publication || (publication.postSeries ?? 0) !== row.postSeries || row.state === "post_unknown") continue;
      const item = await readingItem(ctx, row, adapters, 0);
      if (item) out.push(item);
    }
    return out;
  },
});

/** Records readings the owner asked for: Snapshots outside the schedule, which they never advance. */
export const recordRefreshed = internalMutation({
  args: { readings: v.array(v.object({ id: v.id("publicationAnalytics"), metrics: v.record(v.string(), v.number()) })) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const { id, metrics } of args.readings) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      await insertSnapshot(ctx, row, { delayMs: now - row.publishedAt, takenAt: now, metrics, source: "refresh" });
      // A post the service now answers for is no longer failing or empty; its schedule resumes.
      if (row.state === "failed" || row.state === "no_data") {
        await ctx.db.patch(row._id, {
          state: row.done ? "complete" : "waiting",
          reason: undefined,
          nextAt: Math.max(now, row.publishedAt + (row.delays[row.taken] ?? 0)),
          updatedAt: now,
        });
      }
    }
  },
});

export const outcomeV = v.union(
  v.object({ kind: v.literal("taken"), metrics: v.record(v.string(), v.number()) }),
  v.object({ kind: v.literal("no_data") }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
  v.object({ kind: v.literal("post_unknown"), reason: v.string() }),
  // Not due yet (the adapter reports later than the Template asked) or its key is missing: no reading tried.
  v.object({ kind: v.literal("postponed"), nextAt: v.number() }),
  // Nothing measures this channel (yet): kept and asked again, so linking an adapter later resumes the readings.
  v.object({ kind: v.literal("unmeasured"), reason: v.optional(v.string()) }),
);

type Outcome = Infer<typeof outcomeV>;

async function applyOutcome(ctx: MutationCtx, id: Id<"publicationAnalytics">, outcome: Outcome): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row || row.done) return;
  const now = Date.now();
  switch (outcome.kind) {
    case "taken": {
      await insertSnapshot(ctx, row, { delayMs: row.delays[row.taken], takenAt: now, metrics: outcome.metrics, source: "adapter" });
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
      await ctx.db.patch(row._id, { state: "unmeasured", reason: outcome.reason, nextAt: now + RETRY_AFTER_MS, updatedAt: now });
      return;
  }
}

/** Records the outcomes of the readings tried in one tick. Never touches a Publication. */
export const recordMany = internalMutation({
  args: { outcomes: v.array(v.object({ id: v.id("publicationAnalytics"), outcome: outcomeV })) },
  handler: async (ctx, args) => {
    for (const { id, outcome } of args.outcomes) await applyOutcome(ctx, id, outcome);
  },
});
