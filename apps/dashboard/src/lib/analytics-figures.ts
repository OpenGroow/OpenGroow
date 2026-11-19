// The figures the Analytics page derives from a Publication's readings: the
// latest value of each metric, the engagement rate and the totals across the
// Project's posts. Pure.

export type Reading = { postSeries: number; takenAt: number; metrics: Record<string, number> };
export type MeasuredPost = { snapshots: Reading[]; primaryMetric?: string };

/** The Snapshots of the post the Publication has now (a retry that made a new post starts a new series). */
export function currentReadings<T extends Pick<MeasuredPost, "snapshots">>(post: T): Reading[] {
  const series = Math.max(0, ...post.snapshots.map((s) => s.postSeries));
  return post.snapshots.filter((s) => s.postSeries === series);
}

export function latestMetrics(post: MeasuredPost): Record<string, number> {
  return currentReadings(post).at(-1)?.metrics ?? {};
}

/** What interactions add up to: every social metric but the audience (views, reach). */
const INTERACTIONS = ["likes", "comments", "shares", "saves"] as const;

/** Interactions over views, as a fraction; undefined without views. */
export function engagementRate(metrics: Record<string, number>): number | undefined {
  const views = metrics.views;
  if (!views) return undefined;
  return INTERACTIONS.reduce((sum, key) => sum + (metrics[key] ?? 0), 0) / views;
}

/** The number a post is ranked by: its Mission type's primary metric, else its views. */
export function rankValue(post: MeasuredPost): number | undefined {
  const latest = latestMetrics(post);
  return (post.primaryMetric ? latest[post.primaryMetric] : undefined) ?? latest.views;
}

export type Totals = { posts: number; views: number; engagement?: number };

/** Totals across posts. Engagement is the rate over all the posts that have views, not the mean of their rates. */
export function totalsOf(posts: MeasuredPost[]): Totals {
  let views = 0;
  let interactions = 0;
  for (const post of posts) {
    const latest = latestMetrics(post);
    if (!latest.views) continue;
    views += latest.views;
    interactions += INTERACTIONS.reduce((sum, key) => sum + (latest[key] ?? 0), 0);
  }
  return { posts: posts.length, views, ...(views > 0 ? { engagement: interactions / views } : {}) };
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (value: number | undefined): string => (value === undefined ? "—" : COMPACT.format(value));
export const percent = (fraction: number | undefined): string => (fraction === undefined ? "—" : `${(fraction * 100).toFixed(1)}%`);
