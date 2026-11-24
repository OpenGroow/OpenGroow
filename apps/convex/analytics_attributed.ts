import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import type { QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { linkedAdapters } from "./analytics_adapters.js";
import { isMeasured, metricStats, type MetricStats } from "./analytics_metric_stats.js";
import { claimStatus, measurementClaims } from "./analytics_claims.js";
import { publicationsInWindow, SCAN_LIMIT } from "./analytics_window.js";

// The generic part of an attributed grouping (ADR-084): Publications are attributed to a group by their
// Mission, read adapter by adapter with a platform breakdown inside, with per-metric statistics. A recipe
// grouping and a family grouping differ only in `keyOf` and in what they add to a group.

type Metrics = Record<string, number>;
const DAY_MS = 24 * 60 * 60_000;

export type PlatformReading = { platform: string; publications: number; measured: number; metrics: Record<string, MetricStats> };
export type AdapterReading = {
  adapter: string;
  name: string;
  primary: string;
  /** The declaration: label, type, format and `better` of each metric. */
  metrics: AnalyticsAdapterMeta["metrics"];
  /** Publications of the group whose channel is linked to this adapter (each counted once). */
  publications: number;
  measured: number;
  /** Publications measuring the same page as another Publication of the group: their figures are counted once, on the first one. */
  sharedMeasurements?: number;
  /** Publications whose page is also measured for another group (or for none): credited to no group, so none of their figures is read here. */
  ambiguous?: number;
  /** When the latest readings were taken. Absent when nothing was measured. */
  freshness?: { oldestReadingAt: number; newestReadingAt: number };
  /** No figure across platforms: each platform has its own statistics. */
  platforms: PlatformReading[];
};
export type AttributedGroup = {
  /** Distinct Publications of the group. */
  publications: number;
  lastPublishedAt: number;
  /** How long ago the newest and the oldest Publication of the group were published. */
  publicationAge: { newestMs: number; oldestMs: number };
  adapters: AdapterReading[];
  /** Publications whose channel is linked to no adapter: analytics unavailable. */
  unavailable: Array<{ platform: string; publications: number }>;
  /** The Missions of the group's Publications, one per Publication, for what a grouping adds (versions...). */
  members: Array<{ mission: Doc<"missions">; publishedAt: number }>;
};
export type AttributedRead = {
  groups: Map<string, AttributedGroup>;
  unattributed: number;
  scanLimited: boolean;
  oldestScannedCreatedAt?: number;
};

type Bucket = { publications: number; measured: number; latest: Metrics[] };
type AdapterAcc = { meta: AnalyticsAdapterMeta; publications: number; measured: number; shared: number; ambiguous: number; takenAt: number[]; platforms: Map<string, Bucket> };
type Acc = {
  members: AttributedGroup["members"];
  unavailable: Map<string, number>;
  byAdapter: Map<string, { meta: AnalyticsAdapterMeta; publications: number; measured: number; shared: number; ambiguous: number; takenAt: number[]; platforms: Map<string, { publications: number; measured: number; latest: Metrics[] }> }>;
};

/**
 * Groups the Project's published Publications of the period by `keyOf(mission)`. A Mission with no key is
 * unattributed: counted apart, in no group. `keep` narrows to some keys (a filter); a group exists only
 * if it has Publications.
 */
export async function readAttributed(
  ctx: Pick<QueryCtx, "db">,
  instanceId: string,
  window: { from: number; to: number },
  options: { keyOf: (mission: Doc<"missions">) => string | undefined; /** Which group claims a shared page, when it is not the grouping read (a family's recipes agree with their family). */
    claimKeyOf?: (mission: Doc<"missions">) => string | undefined;
    keep?: (key: string) => boolean; scanLimit?: number; platform?: string; now?: number },
): Promise<AttributedRead> {
  const now = options.now ?? Date.now();
  const { inWindow, installed, scanLimited, oldestScannedCreatedAt } = await publicationsInWindow(ctx, instanceId, window, options.scanLimit ?? SCAN_LIMIT, options.platform);
  const claims = measurementClaims(inWindow, installed, (item) => (options.claimKeyOf ?? options.keyOf)(item.mission));
  let unattributed = 0;
  const accs = new Map<string, Acc>();
  for (const { publication, mission, series, publishedAt, found, platform } of inWindow) {
    const key = options.keyOf(mission);
    if (key === undefined) {
      unattributed += 1;
      continue;
    }
    if (options.keep && !options.keep(key)) continue;
    const acc: Acc = accs.get(key) ?? { members: [], unavailable: new Map(), byAdapter: new Map() };
    accs.set(key, acc);
    acc.members.push({ mission, publishedAt });
    const links = found ? linkedAdapters(installed, found.publisher.adapter, found.channel.analyticsAdapter) : [];
    if (links.length === 0) {
      acc.unavailable.set(platform, (acc.unavailable.get(platform) ?? 0) + 1);
      continue;
    }
    const snapshots = await ctx.db
      .query("performanceSnapshots")
      .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
      .collect();
    for (const { adapter } of links) {
      const entry: AdapterAcc = acc.byAdapter.get(adapter.id) ?? { meta: adapter, publications: 0, measured: 0, shared: 0, ambiguous: 0, takenAt: [], platforms: new Map() };
      acc.byAdapter.set(adapter.id, entry);
      const bucket: Bucket = entry.platforms.get(platform) ?? { publications: 0, measured: 0, latest: [] };
      entry.platforms.set(platform, bucket);
      entry.publications += 1;
      bucket.publications += 1;
      const status = claimStatus(claims, adapter, publication);
      if (status === "ambiguous") {
        entry.ambiguous += 1;
        continue;
      }
      if (status === "shared") {
        entry.shared += 1;
        continue;
      }
      // Another adapter's Snapshots, and an earlier post's, are not this reading.
      const own = snapshots
        .filter((s) => (s.adapter ?? links[0].adapter.id) === adapter.id && s.postSeries === series)
        .sort((a, b) => b.takenAt - a.takenAt)[0];
      // A reading with no usable figure leaves the Publication unmeasured.
      if (own && isMeasured(adapter.metrics, own.metrics)) {
        entry.measured += 1;
        bucket.measured += 1;
        entry.takenAt.push(own.takenAt);
        bucket.latest.push(own.metrics);
      }
    }
  }
  const groups = new Map<string, AttributedGroup>();
  for (const [key, acc] of accs) {
    const dates = acc.members.map((m) => m.publishedAt);
    groups.set(key, {
      publications: acc.members.length,
      lastPublishedAt: Math.max(...dates),
      publicationAge: { newestMs: now - Math.max(...dates), oldestMs: now - Math.min(...dates) },
      adapters: [...acc.byAdapter.values()]
        .sort((a, b) => a.meta.id.localeCompare(b.meta.id))
        .map(({ meta, publications, measured, shared, ambiguous, takenAt, platforms }) => ({
          adapter: meta.id,
          name: meta.name,
          primary: meta.primary,
          metrics: meta.metrics,
          publications,
          measured,
          ...(shared ? { sharedMeasurements: shared } : {}),
          ...(ambiguous ? { ambiguous } : {}),
          ...(takenAt.length ? { freshness: { oldestReadingAt: Math.min(...takenAt), newestReadingAt: Math.max(...takenAt) } } : {}),
          platforms: [...platforms.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([platform, p]) => ({ platform, publications: p.publications, measured: p.measured, metrics: metricStats(meta.metrics, p.latest) })),
        })),
      unavailable: [...acc.unavailable.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([platform, publications]) => ({ platform, publications })),
      members: acc.members,
    });
  }
  return { groups, unattributed, scanLimited, ...(oldestScannedCreatedAt !== undefined ? { oldestScannedCreatedAt } : {}) };
}
