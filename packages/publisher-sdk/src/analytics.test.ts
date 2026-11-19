import { describe, expect, it } from "vitest";
import { ANALYTICS_CONTRACT_VERSION, pickDeclaredMetrics, checkConnectionSecret, isMetricOfKind, metricKindOf, parseAnalyticsManifest, parseAnalyticsMetrics, pickMetrics } from "./analytics";

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
    expect(ANALYTICS_CONTRACT_VERSION).toBe(2);
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
    expect(parseAnalyticsManifest({ ...valid, contractVersion: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/contract 3/) });
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

describe("parseAnalyticsManifest, contract 2", () => {
  const v2 = {
    id: "search-console",
    name: "Search Console",
    contractVersion: 2,
    needs: "url",
    earliestDelayMs: 259200000,
    metrics: [
      { key: "clicks", label: "Clicks", type: "counter", format: "number" },
      { key: "impressions", label: "Impressions", type: "counter", format: "number" },
      { key: "ctr", label: "CTR", type: "level", format: "percent", derive: { sum: ["clicks"], per: "impressions" } },
      { key: "position", label: "Position", type: "level", format: "number", better: "lower" },
    ],
    primary: "clicks",
    collect: ["3d", "7d", "28d"],
  };

  it("accepts metrics, a main metric and delays, and keeps their order", () => {
    const parsed = parseAnalyticsManifest(v2);
    expect(parsed).toMatchObject({ ok: true, manifest: { contractVersion: 2, primary: "clicks", collect: ["3d", "7d", "28d"] } });
    expect(parsed.ok && parsed.manifest.metrics?.map((m) => m.key)).toEqual(["clicks", "impressions", "ctr", "position"]);
  });

  it("still accepts contract 1, which has no metrics", () => {
    const parsed = parseAnalyticsManifest({ id: "postiz", name: "Postiz", contractVersion: 1, needs: "externalId", publisher: "postiz", earliestDelayMs: 0 });
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && parsed.manifest.metrics).toBeUndefined();
  });

  it.each([
    ["no metrics", { metrics: undefined }, /metrics/],
    ["a main metric that is not declared", { primary: "views" }, /primary/],
    ["a derived main metric", { primary: "ctr" }, /primary/],
    ["a duplicate key", { metrics: [v2.metrics[0], v2.metrics[0]] }, /clicks/],
    ["a bad type", { metrics: [{ key: "a", label: "A", type: "gauge", format: "number" }] }, /type/],
    ["a bad format", { metrics: [{ key: "a", label: "A", type: "counter", format: "money" }] }, /format/],
    ["a bad direction", { metrics: [{ key: "a", label: "A", type: "counter", format: "number", better: "up" }] }, /better/],
    ["a derive over an unknown key", { metrics: [{ key: "a", label: "A", type: "level", format: "percent", derive: { sum: ["zzz"], per: "a" } }], primary: "a" }, /zzz/],
    ["a derived counter", { metrics: [v2.metrics[0], { key: "a", label: "A", type: "counter", format: "number", derive: { sum: ["clicks"], per: "clicks" } }] }, /derive/],
    ["a bad delay", { collect: ["soon"] }, /collect/],
    ["a bad secret kind", { secret: { label: "Key", kind: "file" } }, /secret/],
    ["a non-boolean needsUrl", { needsUrl: "no" }, /needsUrl/],
  ])("refuses %s with the reason", (_name, patch, reason) => {
    expect(parseAnalyticsManifest({ ...v2, ...patch })).toMatchObject({ ok: false, error: expect.stringMatching(reason) });
  });

  it("reads the secret and whether a URL is needed", () => {
    const secret = { label: "Service account key", kind: "json", fields: ["client_email", "private_key"] };
    expect(parseAnalyticsManifest({ ...v2, secret, needsUrl: false })).toMatchObject({ ok: true, manifest: { secret, needsUrl: false } });
  });
});

describe("pickDeclaredMetrics", () => {
  const declared = parseAnalyticsManifest({
    id: "x", name: "X", contractVersion: 2, needs: "url", earliestDelayMs: 0, primary: "clicks",
    metrics: [
      { key: "clicks", label: "Clicks", type: "counter", format: "number" },
      { key: "ctr", label: "CTR", type: "level", format: "percent", derive: { sum: ["clicks"], per: "clicks" } },
    ],
  });
  const metrics = declared.ok ? declared.manifest.metrics! : [];
  it("keeps declared stored keys, drops undeclared and derived ones", () => {
    expect(pickDeclaredMetrics(metrics, { clicks: 12, ctr: 0.5, stray: 3 })).toEqual({ clicks: 12 });
  });
  it("drops values that are not finite numbers >= 0", () => {
    expect(pickDeclaredMetrics(metrics, { clicks: "3" })).toEqual({});
  });
});

describe("checkConnectionSecret", () => {
  const secret = { label: "Key", kind: "json" as const, fields: ["client_email", "private_key"] };
  it("accepts a one-line text secret as is", () => {
    expect(checkConnectionSecret(undefined, "abc")).toBeUndefined();
  });
  it("refuses a JSON secret that is not JSON, not an object, or lacks a field", () => {
    expect(checkConnectionSecret(secret, "nope")).toMatch(/not valid JSON/);
    expect(checkConnectionSecret(secret, "[1]")).toMatch(/JSON object/);
    expect(checkConnectionSecret(secret, JSON.stringify({ client_email: "a@b" }))).toMatch(/private_key/);
  });
  it("accepts a JSON secret with the fields", () => {
    expect(checkConnectionSecret(secret, JSON.stringify({ client_email: "a@b", private_key: "k" }))).toBeUndefined();
  });
});
