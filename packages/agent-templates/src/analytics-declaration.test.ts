import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { analyticsDeclarationFor, DEFAULT_ANALYTICS_COLLECT_DAYS } from "./analytics-declaration.js";

// Issue #90, ADR-078, #103 (ADR-079): a Mission type that publishes may declare `analytics: { collect? }`.
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
const warnings = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? (r.warnings ?? []) : [];
};
const reason = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? undefined : r.reason;
};

describe("missionTypes[].analytics", () => {
  it("accepts an empty declaration: opting in needs no metric name", () => {
    expect(validateManifest(social({})).ok).toBe(true);
    expect(validateManifest(article({})).ok).toBe(true);
    expect(warnings(social({}))).toEqual([]);
  });
  it("ignores a metric name with a clear warning, whatever the kind", () => {
    for (const m of [social({ primaryMetric: "views" }), article({ primaryMetric: "views" }), social({ primaryMetric: "impressions" })]) {
      expect(validateManifest(m).ok).toBe(true);
      expect(warnings(m)[0]).toContain("primaryMetric is ignored");
    }
  });
  it("refuses unknown keys", () => {
    expect(reason(social({ frequency: 1 }))).toContain('unknown key "frequency"');
  });
  it("refuses analytics without publish", () => {
    expect(reason(manifestWith({ analytics: {} }))).toContain("publish");
  });
  it("accepts a custom collect list of distinct positive integer days", () => {
    expect(validateManifest(social({ collect: [2, 14] })).ok).toBe(true);
  });
  it.each([[[]], [[0]], [[1, 1]], [[1.5]], [["1d"]], ["7"]])("refuses collect %j", (collect) => {
    expect(reason(social({ collect }))).toContain("collect");
  });
});

describe("analyticsDeclarationFor", () => {
  const manifest = (m: unknown) => m as Parameters<typeof analyticsDeclarationFor>[0];
  it("leaves the delays to the adapter when collect is omitted", () => {
    expect(DEFAULT_ANALYTICS_COLLECT_DAYS).toEqual([1, 3, 7]);
    expect(analyticsDeclarationFor(manifest(social({})), "make")).toEqual({});
  });
  it("honors an override, sorted", () => {
    expect(analyticsDeclarationFor(manifest(social({ collect: [7, 2] })), "make")?.collect).toEqual([2, 7]);
  });
  it("returns undefined for a Mission type without declaration (not measured)", () => {
    expect(analyticsDeclarationFor(manifest(manifestWith({ publish: { kind: "video", resource: { tool: "t" } } })), "make")).toBeUndefined();
    expect(analyticsDeclarationFor(manifest(social({})), "other")).toBeUndefined();
  });
});
