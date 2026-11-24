import { v } from "convex/values";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import { query, type QueryCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { linkedAdapters } from "./analytics_adapters.js";
import { readOwnerId } from "./instance_ownership.js";
import { postFace } from "./analytics_face.js";
import { publicationsInWindow } from "./analytics_window.js";
import { summarizeByRecipe, type RecipeSummary } from "./analytics_recipe.js";
import { summarizeByFamily, type FamilySummary } from "./analytics_family.js";

export { publicationsInWindow, SCAN_LIMIT } from "./analytics_window.js";
import { SCAN_LIMIT } from "./analytics_window.js";

// Aggregated read of how a Project's Publications performed (ADR-078, ADR-079), for Agents reading
// through the Internal MCP (ADR-080): figures by platform, format and Mission type, not raw rows.

const DAY_MS = 24 * 60 * 60_000;
/** The window read when none is given. */
export const DEFAULT_WINDOW_DAYS = 30;
/** The longest period a summary can cover, in days. */
export const MAX_WINDOW_DAYS = 365;

/**
 * The period asked for: a number of days back from `now`, or a start and an end, never both. Publications are
 * selected by publication date in it. Anything unusable is an error, not a silent clamp.
 */
export function resolveWindow(args: { days?: number; from?: number; to?: number }, now: number = Date.now()): { from: number; to: number } {
  const { days, from, to } = args;
  const hasRange = from !== undefined || to !== undefined;
  if (days !== undefined && hasRange) throw new Error("Give either days or a from/to range, not both.");
  if (hasRange) {
    if (from === undefined || to === undefined || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error("A custom range needs both from and to (timestamps in milliseconds).");
    if (from > to) throw new Error("The range starts after it ends: from must be before to.");
    if (to - from > MAX_WINDOW_DAYS * DAY_MS) throw new Error(`The range covers more than ${MAX_WINDOW_DAYS} days.`);
    return { from, to };
  }
  const n = days ?? DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(n) || n < 1) throw new Error("days must be a whole number of at least 1.");
  if (n > MAX_WINDOW_DAYS) throw new Error(`days cannot exceed ${MAX_WINDOW_DAYS}.`);
  return { from: now - n * DAY_MS, to: now };
}

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

/** The summary of a Project's published Publications whose publication date falls in `[from, to]`. */
export async function summarizeProject(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { scanLimit?: number; platform?: string } = {},
): Promise<AnalyticsSummary> {
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, window, options.scanLimit ?? SCAN_LIMIT, options.platform);
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

export type PublicationAttribution =
  | { status: "attributed"; recipeId: string; recipeName: string; version: number; familyId?: string; familyName?: string }
  | { status: "unattributed" };

export type PublicationReading = {
  publicationId: string;
  /** The Run whose approved output was published; absent on a Publication that predates the reference. */
  runId?: string;
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
  /** Whole days since publication. */
  ageDays: number;
  /** Through the Mission's Recipe Snapshot (never the live recipe); `unattributed` when the Mission has none. */
  attribution: PublicationAttribution;
  /** `unavailable`: the channel is linked to no adapter. `no_data`: linked, nothing read yet. `data`: at least one Snapshot. */
  status: "unavailable" | "no_data" | "data";
  /** The latest Snapshot of the current post, one per adapter; adapters' numbers are never combined. */
  measurements: Array<{ adapter: string; takenAt: number; metrics: Metrics }>;
};

export type PublicationList = {
  from: number;
  to: number;
  publications: PublicationReading[];
  /** More Publications matched than `limit`: the list was cut (newest kept). */
  truncated: boolean;
  /** Publications of the period (before the recipe and family filters) with no Recipe Snapshot. */
  unattributed: number;
  scanLimited: boolean;
  oldestScannedCreatedAt?: number;
  /** The read stopped at the scan limit: older Publications may be missing. */
  partial: boolean;
};

const DAY = 24 * 60 * 60_000;

/** The Project's published Publications whose date falls in `[from, to]`, newest first, each with its attribution and latest measurements. */
export async function listPublicationReadings(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  limit: number,
  options: { platform?: string; recipeId?: string; familyId?: string; scanLimit?: number; now?: number } = {},
): Promise<PublicationList> {
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, window, options.scanLimit ?? SCAN_LIMIT, options.platform);
  const now = options.now ?? Date.now();
  const unattributed = inWindow.filter(({ mission }) => !mission.recipeSnapshot).length;
  const recipes = await ctx.db.query("productionRecipes").withIndex("by_instance_family", (q) => q.eq("instanceId", instanceId)).take(2000);
  const familyIdOf = new Map<string, string>(recipes.map((r) => [r._id as string, r.creativeFamilyId as string]));
  const familyNames = new Map<string, string>();
  const matching = inWindow
    .filter(({ mission }) => {
      const recipeId = mission.recipeSnapshot?.recipeId;
      if (options.recipeId !== undefined && recipeId !== options.recipeId) return false;
      if (options.familyId !== undefined && (recipeId === undefined || familyIdOf.get(recipeId) !== options.familyId)) return false;
      return true;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);
  const rows: PublicationReading[] = [];
  for (const { publication, mission, series, publishedAt, found, platform } of matching.slice(0, limit)) {
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
    const snapshot = mission.recipeSnapshot;
    let attribution: PublicationAttribution = { status: "unattributed" };
    if (snapshot) {
      const familyId = familyIdOf.get(snapshot.recipeId);
      if (familyId && !familyNames.has(familyId)) familyNames.set(familyId, (await ctx.db.get(familyId as never as Id<"creativeFamilies">))?.name ?? "");
      attribution = {
        status: "attributed",
        recipeId: snapshot.recipeId,
        recipeName: snapshot.recipeName,
        version: snapshot.version,
        ...(familyId ? { familyId, familyName: familyNames.get(familyId) ?? "" } : {}),
      };
    }
    rows.push({
      publicationId: publication._id,
      ...(publication.runId ? { runId: publication.runId } : {}),
      missionId: mission._id,
      missionName: mission.name ?? mission.summary ?? (mission.number !== undefined ? `Mission #${mission.number}` : "Mission"),
      missionType: mission.type,
      platform,
      ...(found?.channel.channelName ? { channelName: found.channel.channelName } : {}),
      ...(face.kind ? { format: face.kind } : {}),
      ...(face.title ? { title: face.title } : {}),
      ...(publication.externalUrl ? { externalUrl: publication.externalUrl } : {}),
      publishedAt,
      ageDays: Math.max(0, Math.floor((now - publishedAt) / DAY)),
      attribution,
      status: links.length === 0 ? "unavailable" : measurements.length > 0 ? "data" : "no_data",
      measurements,
    });
  }
  return {
    from: window.from,
    to: window.to,
    publications: rows,
    truncated: matching.length > limit,
    unattributed,
    scanLimited,
    ...(oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt } : {}),
    partial: scanLimited,
  };
}

/**
 * Summary of a Project's Publications over the last `days` (default 30) or a `from`/`to` range, optionally for one platform.
 * By default grouped by platform, format and Mission type; `groupBy: "recipe"` groups by Production Recipe (optionally one `recipeId`), `groupBy: "family"` by Creative Family (optionally one `familyId`).
 */
export const summaryForProject = query({
  args: {
    instanceId: v.string(),
    days: v.optional(v.number()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    platform: v.optional(v.string()),
    groupBy: v.optional(v.union(v.literal("recipe"), v.literal("family"))),
    recipeId: v.optional(v.string()),
    familyId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AnalyticsSummary | RecipeSummary | FamilySummary | null> => {
    if (!(await readOwnerId(ctx, args.instanceId))) return null;
    const window = resolveWindow(args);
    if (args.groupBy === "recipe") {
      if (args.familyId !== undefined) throw new Error('familyId needs groupBy "family".');
      return summarizeByRecipe(ctx, args.instanceId, window, { platform: args.platform, recipeId: args.recipeId });
    }
    if (args.groupBy === "family") return summarizeByFamily(ctx, args.instanceId, window, { platform: args.platform, familyId: args.familyId });
    if (args.recipeId !== undefined) throw new Error('recipeId needs groupBy "recipe".');
    if (args.familyId !== undefined) throw new Error('familyId needs groupBy "family".');
    return summarizeProject(ctx, args.instanceId, window, { platform: args.platform });
  },
});
