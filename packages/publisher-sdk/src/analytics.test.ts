import { describe, expect, it } from "vitest";
import { ANALYTICS_CONTRACT_VERSION, metricKindOf, pickMetrics } from "./analytics";

describe("metric vocabulary", () => {
  it("keeps the social metrics for a social post and ignores unknown ones", () => {
    expect(pickMetrics("social", { views: 146, reach: 116, likes: 2, impressions: 9, saves: "3" })).toEqual({
      views: 146,
      reach: 116,
      likes: 2,
    });
  });

  it("keeps the article metrics for an article, not the social ones", () => {
    expect(pickMetrics("article", { pageviews: 10, visitors: 4, engagementTime: 33, views: 5 })).toEqual({
      pageviews: 10,
      visitors: 4,
      engagementTime: 33,
    });
  });

  it("drops values that are not finite numbers", () => {
    expect(pickMetrics("social", { views: Number.NaN, likes: -1, shares: 0 })).toEqual({ shares: 0 });
  });

  it("maps a Publishable kind to its metric kind", () => {
    expect(metricKindOf("article")).toBe("article");
    expect(metricKindOf("image")).toBe("social");
    expect(metricKindOf(undefined)).toBe("social");
  });

  it("has its own contract version", () => {
    expect(ANALYTICS_CONTRACT_VERSION).toBe(1);
  });
});
