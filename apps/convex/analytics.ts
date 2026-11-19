import { v, type Infer } from "convex/values";
import { collectDelayMs, DEFAULT_COLLECT_DELAYS_MS, type AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { adapterOf, installedAnalyticsAdapters, linkedAdapters } from "./analytics_adapters.js";
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
 * The delays (ms after publication, ascending) of a Publication's readings: the Template's, else
 * the adapter's, else the default. Delays that fall on the same moment once held back by the
 * adapter's earliest delay are one reading.
 */
export function readingDelays(templateDays: number[] | undefined, adapter: AnalyticsAdapterMeta | undefined): number[] {
  const earliest = adapter?.earliestDelayMs ?? 0;
  const wanted = templateDays
    ? templateDays.map((days) => days * DAY_MS)
    : adapter?.collect
      ? adapter.collect.map(collectDelayMs)
      : DEFAULT_COLLECT_DELAYS_MS;
  return [...new Set(wanted.map((delay) => Math.max(delay, earliest)))].sort((a, b) => a - b);
}

/**
 * Called when a Publication becomes `published`: schedules its readings, once.
 * `backfill`: a Publication published before it was measured (or before its Mission type declared
 * `analytics`, in the Template version its Mission was made with): its delays count from when it was published, only the ones still to come are
 * scheduled, so no reading is recorded under a delay it does not stand for.
 */
export async function scheduleReadings(ctx: MutationCtx, publication: Doc<"publications">, options: { backfill?: boolean } = {}): Promise<void> {
  // Only a Mission type that declares `analytics` is measured (ADR-078): none, no reading.
  const mission = await ctx.db.get(publication.missionId);
  if (!mission) return;
  const registry = getTemplateRegistry(ctx);
  const pinned = await registry.resolve(publication.instanceId, mission.templateId, mission.templateVersion);
  let declaration = analyticsDeclarationFor(pinned?.manifest, mission.type);
  // A Publication made before its Mission type declared `analytics` was made under a version that does not: a backfill
  // asks the Template the Project has now, since only how to measure is at stake, not how the Mission ran.
  if (!declaration && options.backfill && mission.templateVersion !== undefined) {
    declaration = analyticsDeclarationFor((await registry.resolve(publication.instanceId, mission.templateId))?.manifest, mission.type);
  }
  if (!declaration) return;
  const now = Date.now();
  const publishedAt = options.backfill ? publication.updatedAt : now;
  const publishers = await projectPublishers(ctx, publication.instanceId);
  const found = channelOf(publishers, publication.target);
  const publisherAdapter = publication.attemptContext?.adapter ?? found?.publisher.adapter;
  // One row per adapter the channel is linked to (ADR-079); none: a single row that reads "analytics unavailable".
  const links = publisherAdapter ? linkedAdapters(await installedAnalyticsAdapters(ctx), publisherAdapter, found?.channel.analyticsAdapter) : [];
  const postSeries = publication.postSeries ?? 0;
  const rows = await ctx.db
    .query("publicationAnalytics")
    .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
    .collect();
  // A retry that created a new post: the old post is no longer measured, its Snapshots stay.
  for (const row of rows) if (row.postSeries !== postSeries && !row.done) await ctx.db.patch(row._id, { done: true, updatedAt: Date.now() });
  if (!publisherAdapter) return;
  const current = rows.filter((row) => row.postSeries === postSeries);
  const wanted = links.length > 0 ? links.map((l) => l.adapter) : [undefined];
  for (const [index, adapter] of wanted.entries()) {
    // A row made before several links has no adapter: it belongs to the channel's first link.
    if (current.some((row) => (row.adapter ?? (index === 0 ? adapter?.id : undefined)) === adapter?.id)) continue;
    const all = readingDelays(declaration.collect, adapter);
    const delays = options.backfill ? all.filter((delay) => publishedAt + delay > now) : all;
    // Nothing left to schedule: the post is old enough that only a refresh reads it.
    const finished = delays.length === 0;
    await ctx.db.insert("publicationAnalytics", {
      publicationId: publication._id,
      postSeries,
      instanceId: publication.instanceId,
      ...(adapter ? { adapter: adapter.id } : {}),
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
    .map((s) => ({ ...(s.adapter ? { adapter: s.adapter } : {}), postSeries: s.postSeries, delayMs: s.delayMs, takenAt: s.takenAt, metrics: s.metrics, source: s.source }));
}

/** The readings of a Publication: the state of its current post's series, why, when the next one is due, and all its Snapshots (oldest first, each with its `postSeries`). */
export const forPublication = query({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication || !(await readOwnerId(ctx, publication.instanceId))) return null;
    // Several adapters make several rows: the page shows the first.
    const [row] = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_publication_and_series", (q) => q.eq("publicationId", args.publicationId).eq("postSeries", publication.postSeries ?? 0))
      .take(1);
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
export function postFace(mission: Doc<"missions">, platform: string | undefined) {
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
 * The Analytics Adapters of a Project, the first activated first: those its channels are linked to
 * and those it is connected to. An adapter is activated by the connection the Project made to it,
 * else by the Publisher it comes with.
 */
async function activatedAdapters(ctx: Pick<QueryCtx, "db">, instanceId: string, installed: AnalyticsAdapterMeta[], publishers: Doc<"publishers">[]) {
  const activatedAt = new Map<string, { at: number; adapter: AnalyticsAdapterMeta }>();
  for (const publisher of publishers) {
    for (const target of publisher.targets) {
      for (const { adapter } of linkedAdapters(installed, publisher.adapter, target.analyticsAdapter)) {
        const connection = await projectAnalyticsConnection(ctx, instanceId, adapter.id);
        const at = connection?._creationTime ?? publisher._creationTime;
        const known = activatedAt.get(adapter.id);
        if (!known || at < known.at) activatedAt.set(adapter.id, { at, adapter });
      }
    }
  }
  // An adapter the Project is connected to is activated too, whether or not a channel is linked to it yet.
  for (const adapter of installed) {
    const connection = await projectAnalyticsConnection(ctx, instanceId, adapter.id);
    const known = activatedAt.get(adapter.id);
    if (connection && (!known || connection._creationTime < known.at)) activatedAt.set(adapter.id, { at: connection._creationTime, adapter });
  }
  return [...activatedAt.values()].sort((a, b) => a.at - b.at || a.adapter.id.localeCompare(b.adapter.id)).map((x) => x.adapter);
}

/**
 * The Analytics page's rows: a Project's published Publications with their
 * platform, channel, Mission, Source of origin, the adapter's ranking metric
 * and their readings. Only the Publications whose channel is linked to the
 * chosen adapter (by default the first activated) are listed, with the
 * Snapshots that adapter took: numbers of two adapters are never mixed.
 * Never a per-Mission total: each row is one Publication (ADR-078).
 */
export const listForProject = query({
  args: { instanceId: v.string(), adapter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("desc")
      .take(LIST_LIMIT);
    const publishers = await projectPublishers(ctx, args.instanceId);
    const adapters = await installedAnalyticsAdapters(ctx);
    const chosen = args.adapter ?? (await activatedAdapters(ctx, args.instanceId, adapters, publishers))[0]?.id;
    const rows = [];
    for (const publication of publications) {
      const mission = await ctx.db.get(publication.missionId);
      if (!mission) continue;
      const found = channelOf(publishers, publication.target);
      const links = found ? linkedAdapters(adapters, found.publisher.adapter, found.channel.analyticsAdapter) : [];
      const series = publication.postSeries ?? 0;
      const seriesRows = await ctx.db
        .query("publicationAnalytics")
        .withIndex("by_publication_and_series", (q) => q.eq("publicationId", publication._id).eq("postSeries", series))
        .collect();
      // A row made before several links has no adapter: it belongs to the channel's first link.
      const row = seriesRows.find((r) => chosen === undefined || adapterOf(r.adapter, links) === chosen);
      // A channel with no Analytics Adapter is not measured: nothing to show for it.
      if (!row || row.state === "unmeasured") continue;
      if (chosen !== undefined && !links.some((l) => l.adapter.id === chosen)) continue;
      const snapshots = (
        await ctx.db
          .query("performanceSnapshots")
          .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
          .collect()
      ).filter((s) => chosen === undefined || adapterOf(s.adapter, links) === chosen);
      // The adapter declares what ranks its posts (ADR-079).
      const linked = links.find((l) => l.adapter.id === chosen)?.adapter ?? links[0]?.adapter;
      const primaryMetric = linked?.primary;
      const platform = found?.channel.channelService ?? publication.target.split(":")[0];
      const face = postFace(mission, platform);
      // An article's page gives its image when the Publishable has none.
      const pageImage = face.thumbnailUrl
        ? undefined
        : (await ctx.db.query("pageThumbnails").withIndex("by_publication", (q) => q.eq("publicationId", publication._id)).first())?.url;
      rows.push({
        ...face,
        ...(pageImage ? { thumbnailUrl: pageImage } : {}),
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
 * The published Publications that are not measured because their channel is linked to no Analytics
 * Adapter: the Analytics page lists them as "analytics unavailable" (ADR-078), not as "no data yet".
 */
export const unavailableForProject = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_instance_and_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "published"))
      .order("desc")
      .take(LIST_LIMIT);
    const publishers = await projectPublishers(ctx, args.instanceId);
    const adapters = await installedAnalyticsAdapters(ctx);
    const rows = [];
    for (const publication of publications) {
      const found = channelOf(publishers, publication.target);
      // A channel linked since the reading was scheduled is no longer unavailable.
      if (found && linkedAdapters(adapters, found.publisher.adapter, found.channel.analyticsAdapter).length > 0) continue;
      const analytics = await ctx.db
        .query("publicationAnalytics")
        .withIndex("by_publication_and_series", (q) => q.eq("publicationId", publication._id).eq("postSeries", publication.postSeries ?? 0))
        .first();
      if (analytics?.state !== "unmeasured") continue;
      const mission = await ctx.db.get(publication.missionId);
      if (!mission) continue;
      const platform = found?.channel.channelService ?? publication.target.split(":")[0];
      rows.push({
        publicationId: publication._id,
        missionName: mission.name ?? mission.summary ?? (mission.number !== undefined ? `Mission #${mission.number}` : "Mission"),
        platform,
        ...(found?.channel.channelName ? { channelName: found.channel.channelName } : {}),
        publishedAt: analytics.publishedAt,
        ...(analytics.reason ? { reason: analytics.reason } : {}),
      });
    }
    return rows;
  },
});

/**
 * What the Analytics page builds its picker, columns, tiles and ranking from (ADR-079): the
 * Analytics Adapters the Project's channels are linked to, the first activated first, each with
 * the metrics and ranking metric it declares.
 */
export const adaptersForProject = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    const installed = await installedAnalyticsAdapters(ctx);
    const activated = await activatedAdapters(ctx, args.instanceId, installed, await projectPublishers(ctx, args.instanceId));
    return activated.map((a) => ({ adapter: a.id, name: a.name, ...(a.icon ? { icon: a.icon } : {}), metrics: a.metrics, primary: a.primary }));
  },
});

async function insertSnapshot(
  ctx: MutationCtx,
  row: Doc<"publicationAnalytics">,
  snapshot: { delayMs: number; takenAt: number; metrics: Record<string, number>; source: "adapter" | "refresh"; adapter?: string },
) {
  const adapter = row.adapter ?? snapshot.adapter;
  await ctx.db.insert("performanceSnapshots", {
    publicationId: row.publicationId,
    postSeries: row.postSeries,
    instanceId: row.instanceId,
    ...snapshot,
    ...(adapter ? { adapter } : {}),
  });
}

type ReadingRow = Doc<"publicationAnalytics">;

/** What an adapter needs to take the reading of one Publication (its channel's adapter and connection). */
async function readingItem(ctx: Pick<QueryCtx, "db">, row: ReadingRow, adapters: Awaited<ReturnType<typeof installedAnalyticsAdapters>>, delayMs: number) {
  const publication = await ctx.db.get(row.publicationId);
  if (!publication) return null;
  // The adapter is the one the channel is linked to now (ADR-078): none reads "analytics unavailable".
  const found = channelOf(await projectPublishers(ctx, row.instanceId), publication.target);
  const links = found ? linkedAdapters(adapters, found.publisher.adapter, found.channel.analyticsAdapter) : [];
  // A row made before several links has no adapter: it reads through the channel's first link.
  const link = links.find((l) => l.adapter.id === adapterOf(row.adapter, links)) ?? null;
  // The Project's own connection to the adapter, else (for the adapter of the Publisher's own service) the Publisher's.
  const publisher = found && link?.adapter.publisher === found.publisher.adapter ? found.publisher : undefined;
  const connection = link ? connectionFor(await projectAnalyticsConnection(ctx, row.instanceId, link.adapter.id), publisher) : undefined;
  return {
    id: row._id,
    analyticsAdapter: link?.adapter.id ?? null,
    declaredMetrics: link?.adapter.metrics ?? [],
    publishedAt: row.publishedAt,
    delayMs,
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
  args: { readings: v.array(v.object({ id: v.id("publicationAnalytics"), metrics: v.record(v.string(), v.number()), adapter: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const { id, metrics, adapter } of args.readings) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      await insertSnapshot(ctx, row, { delayMs: now - row.publishedAt, takenAt: now, metrics, source: "refresh", adapter });
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
  v.object({ kind: v.literal("taken"), metrics: v.record(v.string(), v.number()), adapter: v.optional(v.string()) }),
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
      await insertSnapshot(ctx, row, { delayMs: row.delays[row.taken], takenAt: now, metrics: outcome.metrics, source: "adapter", adapter: outcome.adapter });
      const taken = row.taken + 1;
      const complete = taken >= row.delays.length;
      await ctx.db.patch(row._id, {
        // From now on the row is the one of the adapter that read it.
        ...(row.adapter || !outcome.adapter ? {} : { adapter: outcome.adapter }),
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
