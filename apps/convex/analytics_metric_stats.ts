import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";

// Per-metric statistics over the latest readings of several Publications (ADR-084). Pure: shared by every
// attributed grouping (recipe, family). A metric nobody reports is absent from the result, never zero.

type Metrics = Record<string, number>;
type Declared = AnalyticsAdapterMeta["metrics"];

export type StoredMetricStats = {
  /** Publications that report this metric. */
  observations: number;
  /** Counters only. */
  sum?: number;
  mean: number;
  median: number;
};
export type RatioMetricStats = {
  observations: number;
  /** Recomputed from the summed counters, never a mean of rates. */
  recomputed: number;
  /** Mean and median of the ratio of each Publication taken alone. */
  meanOfRatios: number;
  medianOfRatios: number;
};
export type MetricStats = StoredMetricStats | RatioMetricStats;

const usable = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A measured reading has at least one declared stored metric with a usable figure. */
export function isMeasured(declared: Declared, reading: Metrics): boolean {
  return declared.some((m) => !m.derive && usable(reading[m.key]));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Statistics of every declared metric reported by at least one of the readings. */
export function metricStats(declared: Declared, readings: Metrics[]): Record<string, MetricStats> {
  const out: Record<string, MetricStats> = {};
  for (const m of declared) {
    if (m.derive) continue;
    const values = readings.flatMap((r) => (usable(r[m.key]) ? [r[m.key]] : []));
    if (values.length === 0) continue;
    out[m.key] = { observations: values.length, ...(m.type === "counter" ? { sum: values.reduce((a, b) => a + b, 0) } : {}), mean: mean(values), median: median(values) };
  }
  for (const m of declared) {
    if (!m.derive) continue;
    const { sum: numerators, per } = m.derive;
    // A Publication has a ratio when its denominator is positive and it reports at least one numerator.
    const rows = readings.flatMap((r) => {
      const parts = numerators.filter((k) => usable(r[k]));
      return usable(r[per]) && r[per] > 0 && parts.length > 0 ? [{ top: parts.reduce((a, k) => a + r[k], 0), bottom: r[per] }] : [];
    });
    if (rows.length === 0) continue;
    const ratios = rows.map((x) => x.top / x.bottom);
    out[m.key] = {
      observations: rows.length,
      recomputed: rows.reduce((a, x) => a + x.top, 0) / rows.reduce((a, x) => a + x.bottom, 0),
      meanOfRatios: mean(ratios),
      medianOfRatios: median(ratios),
    };
  }
  return out;
}
