import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { analyticsDeclarationFor, DEFAULT_ANALYTICS_COLLECT_DAYS } from "./analytics-declaration.js";
import { ANALYTICS_METRICS } from "./analytics-metrics.js";

// Issue #90, ADR-078: a Mission type that publishes may declare `analytics`.
const SERVER = { name: "mcp", transport: "streamable-http", url: "http://localhost/mcp" };
const JOB = {
  produce: {
    server: "mcp", mcpTool: "get_run_status", statusField: "status",
    terminalStates: { completed: ["done"], failed: ["error"] },
    resultStatus: "needs_human_review", artifactKind: "video", onComplete: "terminal",
  },
};
const manifestWith = (extra: Record<string, unknown>) => ({
  id: "t", name: "T", description: "d", category: "test", mcpServers: [SERVER],
  externalJobsByMissionType: { make: JOB },
  missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "make.md", ...extra }],
});
const social = (analytics: unknown) => manifestWith({ publish: { kind: "video", resource: { tool: "get_video" } }, analytics });
const article = (analytics: unknown) => manifestWith({ publish: { kind: "article", resource: { tool: "get_article" } }, analytics });
const reason = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? undefined : r.reason;
};

describe("missionTypes[].analytics", () => {
  it("accepts a social primary metric for a social kind", () => {
    expect(validateManifest(social({ primaryMetric: "views" })).ok).toBe(true);
  });
  it("accepts an article primary metric for an article", () => {
    expect(validateManifest(article({ primaryMetric: "pageviews" })).ok).toBe(true);
  });
  it("refuses an article metric on a social kind and vice versa", () => {
    expect(reason(social({ primaryMetric: "pageviews" }))).toContain('"pageviews"');
    expect(reason(article({ primaryMetric: "views" }))).toContain('"views"');
  });
  it("refuses a metric outside the vocabulary", () => {
    expect(reason(social({ primaryMetric: "impressions" }))).toContain(ANALYTICS_METRICS.social.join(", "));
  });
  it("requires a primary metric", () => {
    expect(reason(social({}))).toContain("primaryMetric");
  });
  it("refuses unknown keys", () => {
    expect(reason(social({ primaryMetric: "views", frequency: 1 }))).toContain('unknown key "frequency"');
  });
  it("refuses analytics without publish", () => {
    expect(reason(manifestWith({ analytics: { primaryMetric: "views" } }))).toContain("publish");
  });
  it("accepts a custom collect list of distinct positive integer days", () => {
    expect(validateManifest(social({ primaryMetric: "views", collect: [2, 14] })).ok).toBe(true);
  });
  it.each([[[]], [[0]], [[1, 1]], [[1.5]], [["1d"]], ["7"]])("refuses collect %j", (collect) => {
    expect(reason(social({ primaryMetric: "views", collect }))).toContain("collect");
  });
});

describe("analyticsDeclarationFor", () => {
  const manifest = (m: unknown) => m as Parameters<typeof analyticsDeclarationFor>[0];
  it("applies the default delays when collect is omitted", () => {
    expect(DEFAULT_ANALYTICS_COLLECT_DAYS).toEqual([1, 3, 7]);
    expect(analyticsDeclarationFor(manifest(social({ primaryMetric: "views" })), "make")).toEqual({ primaryMetric: "views", collect: [1, 3, 7] });
  });
  it("honors an override, sorted", () => {
    expect(analyticsDeclarationFor(manifest(social({ primaryMetric: "views", collect: [7, 2] })), "make")?.collect).toEqual([2, 7]);
  });
  it("returns undefined for a Mission type without declaration (not measured)", () => {
    expect(analyticsDeclarationFor(manifest(manifestWith({ publish: { kind: "video", resource: { tool: "t" } } })), "make")).toBeUndefined();
    expect(analyticsDeclarationFor(manifest(social({ primaryMetric: "views" })), "other")).toBeUndefined();
  });
});
