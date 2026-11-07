import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

  it("prints usage and fails without a command", () => {
    const { code, err } = runCli([]);
    expect(code).toBe(1);
    expect(err[0]).toContain("Usage");
  });
});
