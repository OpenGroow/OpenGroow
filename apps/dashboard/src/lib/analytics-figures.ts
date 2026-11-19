// The figures the Analytics page derives from a Publication's readings and the
// adapter's declaration of its metrics (ADR-079): the latest value of each
// metric, derived figures (engagement), the ranking and the totals. Pure.

export type Reading = { postSeries: number; takenAt: number; metrics: Record<string, number> };
export type MeasuredPost = { snapshots: Reading[] };

/** A metric an adapter declares (`MetricDecl` of the Publisher SDK). */
export type MetricDecl = {
  key: string;
  label: string;
  type: "counter" | "level";
  format: "number" | "percent" | "duration";
  better?: "higher" | "lower";
  derive?: { sum: string[]; per: string };
};
export type Declaration = { metrics: MetricDecl[]; primary: string };

/**
 * What a contract 1 adapter measures (closed social vocabulary, ADR-078): the page for such an adapter
 * looks as it did before adapters declared their metrics.
 */
export const LEGACY_DECLARATION: Declaration = {
  primary: "views",
  metrics: [
    { key: "views", label: "Views", type: "counter", format: "number" },
    { key: "likes", label: "Likes", type: "counter", format: "number" },
    { key: "comments", label: "Comments", type: "counter", format: "number" },
    { key: "engagement", label: "Engagement", type: "level", format: "percent", derive: { sum: ["likes", "comments", "shares", "saves"], per: "views" } },
    { key: "reach", label: "Reach", type: "counter", format: "number" },
    { key: "shares", label: "Shares", type: "counter", format: "number" },
    { key: "saves", label: "Saves", type: "counter", format: "number" },
  ],
};

/** How many metrics are columns before the Columns menu. */
export const DEFAULT_COLUMNS = 4;

/** The Snapshots of the post the Publication has now (a retry that made a new post starts a new series). */
export function currentReadings<T extends Pick<MeasuredPost, "snapshots">>(post: T): Reading[] {
  const series = Math.max(0, ...post.snapshots.map((s) => s.postSeries));
  return post.snapshots.filter((s) => s.postSeries === series);
}

export function latestMetrics(post: MeasuredPost): Record<string, number> {
  return currentReadings(post).at(-1)?.metrics ?? {};
}

/** A derived figure over stored values: the declared keys added, over `per`; undefined without `per`. Never stored. */
function derived(decl: MetricDecl, values: Record<string, number | undefined>): number | undefined {
  const { sum, per } = decl.derive!;
  const base = values[per];
  if (!base) return undefined;
  return sum.reduce((total, key) => total + (values[key] ?? 0), 0) / base;
}

/** The value of one declared metric in a set of stored values (derived ones are computed); undefined when it has none. */
export function valueOf(decl: MetricDecl, values: Record<string, number | undefined>): number | undefined {
  return decl.derive ? derived(decl, values) : values[decl.key];
}

/** The declared metrics a post has a value for, in the order of the declaration: a metric no longer declared is not there. */
export function shownMetrics(declaration: Declaration, post: MeasuredPost): MetricDecl[] {
  const latest = latestMetrics(post);
  return declaration.metrics.filter((m) => valueOf(m, latest) !== undefined);
}

export type Change =
  | { kind: "variation"; delta: number }
  | { kind: "trend"; direction: "up" | "down" | "flat"; verdict: "improving" | "worsening" | "steady" };

/**
 * How a metric moved since the previous reading of the post's current series: a counter has its variation,
 * a level its trend, oriented by `better` (a lower position going down is improving). Undefined with fewer
 * than two readings having a value.
 */
export function changeOf(decl: MetricDecl, post: MeasuredPost): Change | undefined {
  const readings = currentReadings(post).filter((r) => valueOf(decl, r.metrics) !== undefined);
  if (readings.length < 2) return undefined;
  const [before, after] = [valueOf(decl, readings.at(-2)!.metrics)!, valueOf(decl, readings.at(-1)!.metrics)!];
  if (decl.type === "counter") return { kind: "variation", delta: after - before };
  const direction = after > before ? "up" : after < before ? "down" : "flat";
  const good = decl.better === "lower" ? "down" : "up";
  return { kind: "trend", direction, verdict: direction === "flat" ? "steady" : direction === good ? "improving" : "worsening" };
}

const primaryDecl = (declaration: Declaration) => declaration.metrics.find((m) => m.key === declaration.primary);

/** The number a post is ranked by: the adapter's main metric. */
export function rankValue(declaration: Declaration, post: MeasuredPost): number | undefined {
  const main = primaryDecl(declaration);
  return main ? valueOf(main, latestMetrics(post)) : undefined;
}

/** Compares two posts best first, per the main metric's direction; a post with no value comes last. */
export function byRank(declaration: Declaration) {
  const sign = primaryDecl(declaration)?.better === "lower" ? -1 : 1;
  return (a: MeasuredPost, b: MeasuredPost) => {
    const [x, y] = [rankValue(declaration, a), rankValue(declaration, b)];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return sign * (y - x);
  };
}

/** The best post by the main metric, among those that have a value. */
export function bestPost<T extends MeasuredPost>(declaration: Declaration, posts: T[]): T | undefined {
  return posts.filter((p) => rankValue(declaration, p) !== undefined).sort(byRank(declaration))[0];
}

export type Totals = { posts: number; values: Record<string, number | undefined> };

/**
 * Totals across posts: a counter is summed, a derived figure is recomputed from the sums (the rate over all
 * the posts that have the base, never the mean of their rates), a level has no total.
 */
export function totalsOf(declaration: Declaration, posts: MeasuredPost[]): Totals {
  const values: Record<string, number | undefined> = {};
  const latests = posts.map(latestMetrics);
  for (const m of declaration.metrics) {
    if (m.derive) {
      // Only the posts that have the base count, in the numerator too.
      const { per, sum } = m.derive;
      const counting = latests.filter((latest) => latest[per]);
      const sums: Record<string, number> = {};
      for (const key of [per, ...sum]) sums[key] = counting.reduce((total, latest) => total + (latest[key] ?? 0), 0);
      values[m.key] = derived(m, sums);
    } else if (m.type === "counter") {
      const have = latests.map((latest) => latest[m.key]).filter((v): v is number => v !== undefined);
      if (have.length > 0) values[m.key] = have.reduce((a, b) => a + b, 0);
    }
  }
  return { posts: posts.length, values };
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (value: number | undefined): string => (value === undefined ? "—" : COMPACT.format(value));
export const percent = (fraction: number | undefined): string => (fraction === undefined ? "—" : `${(fraction * 100).toFixed(1)}%`);
/** Seconds as `1m 05s`. */
export const duration = (seconds: number | undefined): string => {
  if (seconds === undefined) return "—";
  const total = Math.round(seconds);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

/** `+34`, `-5`; nothing for a counter that did not move. */
export function formatVariation(decl: MetricDecl, delta: number): string | undefined {
  if (delta === 0) return undefined;
  return `${delta > 0 ? "+" : "-"}${formatValue(decl, Math.abs(delta))}`;
}

/** A value in the format its metric declares; a dash when there is none. */
export function formatValue(decl: MetricDecl, value: number | undefined): string {
  if (value === undefined) return "—";
  if (decl.format === "percent") return percent(value);
  if (decl.format === "duration") return duration(value);
  return decl.type === "level" ? String(Math.round(value * 10) / 10) : compact(value);
}
