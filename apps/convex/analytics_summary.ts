import { v } from "convex/values";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import { query, type QueryCtx } from "./_generated/server.js";
import { installedAnalyticsAdapters, linkedAdapters } from "./analytics_adapters.js";
import { readOwnerId } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";
import { LIST_LIMIT, publishedOf } from "./analytics.js";
import { postFace } from "./analytics_face.js";
import type { Doc } from "./_generated/dataModel.js";

// Aggregated read of how a Project's Publications performed (ADR-078, ADR-079), for Agents reading
// through the Internal MCP (ADR-080): figures by platform, format and Mission type, not raw rows.

const DAY_MS = 24 * 60 * 60_000;
/** The window read when none is given. */
export const DEFAULT_WINDOW_DAYS = 30;
/** The most published Publications the summary reads, newest created first (ADR-084). It bounds the database reads. */
export const SCAN_LIMIT = 2000;

type Metrics = Record<string, number>;

/**
 * Adds up the latest readings of several posts of one adapter. Counters are summed; a derived level
 * is recomputed from the summed counters (never a mean of rates); another level is the mean of the
 * posts that report it.
 */
export function aggregateMetrics(declared: AnalyticsAdapterMeta["metrics"], readings: Metrics[]): Metrics {
  const out: Metrics = {};
  for (const m of declared) {
    if (m.derive) continue;
    const values = readings.flatMap((r) => (typeof r[m.key] === "number" ? [r[m.key]] : []));
    if (values.length === 0) continue;
    const total = values.reduce((a, b) => a + b, 0);
    out[m.key] = m.type === "counter" ? total : total / values.length;
  }
  for (const m of declared) {
    if (!m.derive) continue;
    const per = out[m.derive.per];
    if (!per) continue;
    out[m.key] = m.derive.sum.reduce((a, k) => a + (out[k] ?? 0), 0) / per;
  }
  return out;
}

export type SummaryGroup = {
  platform: string;
  /** The kind of the Publishable (`image`, `video`, `article`...), absent when the Mission has none. */
  format?: string;
  missionType: string;
  publications: number;
  /** `data`: at least one Publication has a Snapshot. `no_data`: the channel is linked, nothing was read yet. */
  status: "data" | "no_data";
  /** Publications with at least one Snapshot. */
  measured: number;
  metrics: Metrics;
};

export type AnalyticsSummary = {
  from: number;
  to: number;
  /** One entry per adapter; its numbers are never combined with another's. */
  adapters: Array<{
    adapter: string;
    name: string;
    primary: string;
    /** The declaration: label, type, format and `better` ("higher" or "lower") of each metric. */
    metrics: AnalyticsAdapterMeta["metrics"];
    groups: SummaryGroup[];
  }>;
  /** Publications whose channel is linked to no adapter: analytics unavailable, not "no data yet". */
  unavailable: Array<{ platform: string; format?: string; missionType: string; publications: number }>;
  /** Publications in the period whose Mission has no Recipe Snapshot (no recipe, no family). */
  unattributed: number;
  /** The read stopped at the scan limit: older Publications may be missing. Distinct from truncating a list. */
  scanLimited: boolean;
  /** Creation date of the oldest Publication read; present only when `scanLimited`. */
  oldestScannedCreatedAt?: number;
  /** The totals above are incomplete (same as `scanLimited`). */
  partial: boolean;
};

type PublicationInWindow = {
  publication: Doc<"publications">;
  mission: Doc<"missions">;
  /** The post of the Publication that is current (`postSeries`, 0 when it has no series). */
  series: number;
  publishedAt: number;
  found: ReturnType<typeof channelOf>;
  platform: string;
};

/** The Project's published Publications whose publication date falls in `[from, to]`, each with its Mission and channel. */
export async function publicationsInWindow(ctx: Pick<QueryCtx, "db">, instanceId: string, window: { from: number; to: number }, cap: number = LIST_LIMIT) {
  const publications = await publishedOf(ctx, instanceId, cap);
  const publishers = await projectPublishers(ctx, instanceId);
  const installed = await installedAnalyticsAdapters(ctx);
  const inWindow: PublicationInWindow[] = [];
  for (const publication of publications) {
    const mission = await ctx.db.get(publication.missionId);
    if (!mission) continue;
    const series = publication.postSeries ?? 0;
    const analytics = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_publication_and_series", (q) => q.eq("publicationId", publication._id).eq("postSeries", series))
      .first();
    const publishedAt = analytics?.publishedAt ?? publication.updatedAt;
    if (publishedAt < window.from || publishedAt > window.to) continue;
    const found = channelOf(publishers, publication.target);
    const platform = found?.channel.channelService ?? publication.target.split(":")[0];
    inWindow.push({ publication, mission, series, publishedAt, found, platform });
  }
  // A full page may hide older rows; a shorter one is the whole set.
  const scanLimited = publications.length >= cap;
  const oldestScannedCreatedAt = scanLimited ? publications[publications.length - 1]._creationTime : undefined;
  return { inWindow, installed, scanLimited, oldestScannedCreatedAt };
}

/** The summary of a Project's published Publications whose publication date falls in `[from, to]`. */
export async function summarizeProject(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { scanLimit?: number } = {},
): Promise<AnalyticsSummary> {
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, window, options.scanLimit ?? SCAN_LIMIT);
  let unattributed = 0;
  type Acc = SummaryGroup & { latest: Metrics[] };
  const byAdapter = new Map<string, { meta: AnalyticsAdapterMeta; groups: Map<string, Acc> }>();
  const unavailable = new Map<string, AnalyticsSummary["unavailable"][number]>();
  for (const { publication, mission, series, found, platform } of inWindow) {
    if (!mission.recipeSnapshot) unattributed += 1;
    const format = postFace(mission, platform).kind;
    const key = `${platform}\u0000${format ?? ""}\u0000${mission.type}`;
    const links = found ? linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter) : [];
    if (links.length === 0) {
      const known = unavailable.get(key);
      if (known) known.publications += 1;
      else unavailable.set(key, { platform, ...(format ? { format } : {}), missionType: mission.type, publications: 1 });
      continue;
    }
    const snapshots = await ctx.db
      .query("performanceSnapshots")
      .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
      .collect();
    for (const { adapter } of links) {
      const entry = byAdapter.get(adapter.id) ?? { meta: adapter, groups: new Map<string, Acc>() };
      byAdapter.set(adapter.id, entry);
      const group =
        entry.groups.get(key) ??
        ({ platform, ...(format ? { format } : {}), missionType: mission.type, publications: 0, status: "no_data", measured: 0, metrics: {}, latest: [] } as Acc);
      entry.groups.set(key, group);
      group.publications += 1;
      // Snapshots of other adapters, and of an earlier post of the Publication, are not this reading.
      const own = snapshots
        .filter((s) => (s.adapter ?? links[0].adapter.id) === adapter.id && s.postSeries === series)
        .sort((a, b) => b.takenAt - a.takenAt)[0];
      if (own) {
        group.measured += 1;
        group.latest.push(own.metrics);
      }
    }
  }
  return {
    from: window.from,
    to: window.to,
    adapters: [...byAdapter.values()]
      .sort((a, b) => a.meta.id.localeCompare(b.meta.id))
      .map(({ meta, groups }) => ({
        adapter: meta.id,
        name: meta.name,
        primary: meta.primary,
        metrics: meta.metrics,
        groups: [...groups.values()].map(({ latest, ...group }) => ({
          ...group,
          status: group.measured > 0 ? ("data" as const) : ("no_data" as const),
          metrics: aggregateMetrics(meta.metrics, latest),
        })),
      })),
    unavailable: [...unavailable.values()],
    unattributed,
    scanLimited,
    ...(oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt } : {}),
    partial: scanLimited,
  };
}

export type PublicationReading = {
  publicationId: string;
  missionId: string;
  missionName: string;
  missionType: string;
  platform: string;
  channelName?: string;
  /** The kind of the Publishable (`image`, `video`, `article`...). */
  format?: string;
  title?: string;
  externalUrl?: string;
  publishedAt: number;
  /** `unavailable`: the channel is linked to no adapter. `no_data`: linked, nothing read yet. `data`: at least one Snapshot. */
  status: "unavailable" | "no_data" | "data";
  /** The latest Snapshot of the current post, one per adapter; adapters' numbers are never combined. */
  measurements: Array<{ adapter: string; takenAt: number; metrics: Metrics }>;
};

/** The Project's published Publications whose date falls in `[from, to]`, newest first, each with its latest measurements. */
export async function listPublicationReadings(ctx: Pick<QueryCtx, "db">, instanceId: string, window: { from: number; to: number }, limit: number): Promise<PublicationReading[]> {
  const { inWindow, installed } = await publicationsInWindow(ctx, instanceId, window);
  const rows: PublicationReading[] = [];
  for (const { publication, mission, series, publishedAt, found, platform } of inWindow) {
    const links = found ? linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter) : [];
    const snapshots = links.length
      ? await ctx.db
          .query("performanceSnapshots")
          .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
          .collect()
      : [];
    const measurements = links.flatMap(({ adapter }) => {
      const latest = snapshots.filter((s) => (s.adapter ?? links[0].adapter.id) === adapter.id && s.postSeries === series).sort((a, b) => b.takenAt - a.takenAt)[0];
      return latest ? [{ adapter: adapter.id, takenAt: latest.takenAt, metrics: latest.metrics as Metrics }] : [];
    });
    const face = postFace(mission, platform);
    rows.push({
      publicationId: publication._id,
      missionId: mission._id,
      missionName: mission.name ?? mission.summary ?? (mission.number !== undefined ? `Mission #${mission.number}` : "Mission"),
      missionType: mission.type,
      platform,
      ...(found?.channel.channelName ? { channelName: found.channel.channelName } : {}),
      ...(face.kind ? { format: face.kind } : {}),
      ...(face.title ? { title: face.title } : {}),
      ...(publication.externalUrl ? { externalUrl: publication.externalUrl } : {}),
      publishedAt,
      status: links.length === 0 ? "unavailable" : measurements.length > 0 ? "data" : "no_data",
      measurements,
    });
  }
  return rows.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
}

/** Summary of a Project's Publications by platform, format and Mission type over the last `days` (default 30). */
export const summaryForProject = query({
  args: { instanceId: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, args): Promise<AnalyticsSummary | null> => {
    if (!(await readOwnerId(ctx, args.instanceId))) return null;
    const to = Date.now();
    return summarizeProject(ctx, args.instanceId, { from: to - (args.days ?? DEFAULT_WINDOW_DAYS) * DAY_MS, to });
  },
});
