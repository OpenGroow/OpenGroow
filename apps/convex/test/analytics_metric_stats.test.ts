import { describe, expect, it } from "vitest";
import { isMeasured, median, metricStats } from "../analytics_metric_stats";
import { SOCIAL_METRICS } from "./analytics_fixture";

describe("metric statistics (ADR-084)", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 10])).toBe(3);
  });

  it("leaves out a metric nobody reports and ignores non-numbers", () => {
    const stats = metricStats(SOCIAL_METRICS, [{ views: 10 }, { views: Number.NaN }, {}]);
    expect(Object.keys(stats)).toEqual(["views"]);
    expect(stats.views).toEqual({ observations: 1, sum: 10, mean: 10, median: 10 });
  });

  it("skips a ratio whose denominator is zero or missing", () => {
    expect(metricStats(SOCIAL_METRICS, [{ views: 0, likes: 5 }, { likes: 5 }]).engagement).toBeUndefined();
  });

  it("is measured only with a declared stored metric", () => {
    expect(isMeasured(SOCIAL_METRICS, {})).toBe(false);
    expect(isMeasured(SOCIAL_METRICS, { engagement: 0.5, other: 1 })).toBe(false);
    expect(isMeasured(SOCIAL_METRICS, { likes: 0 })).toBe(true);
  });
});
