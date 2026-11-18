import { describe, expect, it } from "vitest";
import { ANALYTICS_CONTRACT_VERSION, isMetricOfKind, metricKindOf, parseAnalyticsManifest, parseAnalyticsMetrics, pickMetrics } from "./analytics";

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

describe("isMetricOfKind", () => {
  it("accepts a metric of the kind and refuses another kind's or an unknown one", () => {
    expect(isMetricOfKind("social", "views")).toBe(true);
    expect(isMetricOfKind("social", "pageviews")).toBe(false);
    expect(isMetricOfKind("article", "visitors")).toBe(true);
    expect(isMetricOfKind("article", 3)).toBe(false);
  });
});

describe("parseAnalyticsManifest", () => {
  const valid = { id: "postiz", name: "Postiz", contractVersion: 1, needs: "externalId", publisher: "postiz", earliestDelayMs: 3600000 };

  it("reads what a package declares: key, delay, Publisher and options", () => {
    const options = [{ key: "lookbackDays", label: "Look-back window (days)", type: "number", default: 7, min: 1, max: 90 }];
    expect(parseAnalyticsManifest({ ...valid, options })).toEqual({ ok: true, manifest: { ...valid, options } });
  });

  it("refuses another contract version, an unknown key and a negative delay", () => {
    expect(parseAnalyticsManifest({ ...valid, contractVersion: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/contract 2/) });
    expect(parseAnalyticsManifest({ ...valid, needs: "caption" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs/) });
    expect(parseAnalyticsManifest({ ...valid, earliestDelayMs: -1 })).toMatchObject({ ok: false, error: expect.stringMatching(/earliestDelayMs/) });
  });

  it("refuses an option whose default is not of its type", () => {
    const bad = { key: "lookbackDays", label: "x", type: "number", default: "7" };
    expect(parseAnalyticsManifest({ ...valid, options: [bad] })).toMatchObject({ ok: false, error: expect.stringMatching(/lookbackDays/) });
  });
});

describe("parseAnalyticsMetrics", () => {
  it("maps the labels of a service to the closed vocabulary", () => {
    expect(parseAnalyticsMetrics({ schemaVersion: 1, adapter: "postiz", kind: "social", labels: { Views: "views", Likes: "likes" } })).toEqual({
      adapter: "postiz",
      kind: "social",
      labels: { Views: "views", Likes: "likes" },
    });
  });

  it("refuses a metric outside the vocabulary of its kind", () => {
    expect(() => parseAnalyticsMetrics({ schemaVersion: 1, adapter: "postiz", kind: "social", labels: { Visitors: "visitors" } })).toThrow(/visitors/);
  });
});
