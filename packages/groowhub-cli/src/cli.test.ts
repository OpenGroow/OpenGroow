import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, run } from "./cli.js";

function runCli(argv: string[], cwd = process.cwd()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { cwd, log: (l) => out.push(l), error: (l) => err.push(l) });
  return { code, out, err };
}

describe("parseArgs", () => {
  it("parses validate template with a tag", () => {
    expect(parseArgs(["validate", "template", "packages/seo", "--tag", "seo@1.0.0"])).toEqual({
      command: "validate-template",
      folder: "packages/seo",
      tag: "seo@1.0.0",
    });
  });

  it("parses validate index, for Templates by default", () => {
    expect(parseArgs(["validate", "index", "index.json"])).toEqual({ command: "validate-index", file: "index.json", kind: "template" });
    expect(parseArgs(["validate", "index", "publishers.json", "--kind", "publisher"])).toEqual({ command: "validate-index", file: "publishers.json", kind: "publisher" });
  });

  it("parses validate publisher and pack publisher", () => {
    expect(parseArgs(["validate", "publisher", "packages/publisher/postiz"])).toEqual({ command: "validate-publisher", folder: "packages/publisher/postiz" });
    expect(parseArgs(["pack", "publisher", "p", "--out", "dist", "--index", "publishers.json"])).toEqual({ command: "pack-publisher", folder: "p", out: "dist", index: "publishers.json" });
  });

  it("parses validate analytics, pack analytics and the analytics index kind", () => {
    expect(parseArgs(["validate", "analytics", "packages/analytics/postiz"])).toEqual({ command: "validate-analytics", folder: "packages/analytics/postiz" });
    expect(parseArgs(["pack", "analytics", "p", "--out", "dist"])).toEqual({ command: "pack-analytics", folder: "p", out: "dist" });
    expect(parseArgs(["validate", "index", "analytics.json", "--kind", "analytics"])).toEqual({ command: "validate-index", file: "analytics.json", kind: "analytics" });
  });

  it("rejects an unknown command, a missing folder and a dangling --tag", () => {
    expect(() => parseArgs([])).toThrow("Usage");
    expect(() => parseArgs(["validate"])).toThrow("Usage");
    expect(() => parseArgs(["validate", "template"])).toThrow("missing <folder>");
    expect(() => parseArgs(["validate", "template", "dir", "--tag"])).toThrow("--tag needs a value");
    expect(() => parseArgs(["validate", "index"])).toThrow("missing <index.json>");
    expect(() => parseArgs(["validate", "index", "i.json", "--kind", "x"])).toThrow("unknown kind");
    expect(() => parseArgs(["pack", "publisher", "dir"])).toThrow("missing --out");
  });
});

describe("run", () => {
  it("fails on a folder that is not a package", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "empty"));
    const { code, err } = runCli(["validate", "template", "empty"], dir);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^ERROR empty: /);
  });

  it("fails on an unreadable or invalid index", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    expect(runCli(["validate", "index", "missing.json"], dir).code).toBe(1);
    writeFileSync(join(dir, "index.json"), JSON.stringify({ nope: true }));
    const { code, err } = runCli(["validate", "index", "index.json"], dir);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^ERROR index.json: /);
  });

  it("accepts an empty-but-valid index", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ schemaVersion: 1, packages: [] }));
    const { code, out, err } = runCli(["validate", "index", "index.json"], dir);
    expect({ code, err }).toEqual({ code: 0, err: [] });
    expect(out).toEqual(["OK 0 package(s)"]);
  });

  it("validates an Analytics Adapter folder and refuses one named after another adapter", () => {
    const folder = join(__dirname, "../../../apps/convex/test/postiz_analytics_reference");
    expect(runCli(["validate", "analytics", folder]).out).toEqual(["OK @opengroow/analytics-postiz@1.0.0"]);
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@opengroow/analytics-other", version: "1.0.0" }));
    writeFileSync(join(dir, "manifest.json"), readFileSync(join(folder, "manifest.json")));
    writeFileSync(join(dir, "data/metrics.json"), readFileSync(join(folder, "data/metrics.json")));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/index.ts"), "export default {};");
    const { code, err } = runCli(["validate", "analytics", dir]);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/expected the name analytics-postiz/);
  });

  it("refuses an Analytics Adapter whose metrics.json maps a label to a metric the manifest does not store", () => {
    const folder = join(__dirname, "../../../apps/convex/test/postiz_analytics_reference");
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "data"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@opengroow/analytics-postiz", version: "1.0.0" }));
    writeFileSync(join(dir, "manifest.json"), readFileSync(join(folder, "manifest.json")));
    writeFileSync(join(dir, "src/index.ts"), "export default {};");
    writeFileSync(join(dir, "data/metrics.json"), JSON.stringify({ schemaVersion: 1, adapter: "postiz", labels: { Rate: "engagement", Ghost: "ghost" } }));
    const { code, err } = runCli(["validate", "analytics", dir]);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/data\/metrics.json maps a label to "engagement"/);
  });

  it("prints usage and fails without a command", () => {
    const { code, err } = runCli([]);
    expect(code).toBe(1);
    expect(err[0]).toContain("Usage");
  });
});
