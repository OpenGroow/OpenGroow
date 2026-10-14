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
  it("parses package with a tag", () => {
    expect(parseArgs(["package", "packages/seo", "--tag", "seo@1.0.0"])).toEqual({
      command: "package",
      folder: "packages/seo",
      tag: "seo@1.0.0",
    });
  });

  it("parses index", () => {
    expect(parseArgs(["index", "index.json"])).toEqual({ command: "index", file: "index.json" });
  });

  it("rejects an unknown command, a missing folder and a dangling --tag", () => {
    expect(() => parseArgs([])).toThrow("Usage");
    expect(() => parseArgs(["validate"])).toThrow("Usage");
    expect(() => parseArgs(["package"])).toThrow("missing <folder>");
    expect(() => parseArgs(["package", "dir", "--tag"])).toThrow("--tag needs a value");
    expect(() => parseArgs(["index"])).toThrow("missing <index.json>");
  });
});

describe("run", () => {
  it("fails on a folder that is not a package", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "empty"));
    const { code, err } = runCli(["package", "empty"], dir);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^ERROR empty: /);
  });

  it("fails on an unreadable or invalid index", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    expect(runCli(["index", "missing.json"], dir).code).toBe(1);
    writeFileSync(join(dir, "index.json"), JSON.stringify({ nope: true }));
    const { code, err } = runCli(["index", "index.json"], dir);
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^ERROR index.json: /);
  });

  it("accepts an empty-but-valid index", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ schemaVersion: 1, packages: [] }));
    const { code, out, err } = runCli(["index", "index.json"], dir);
    expect({ code, err }).toEqual({ code: 0, err: [] });
    expect(out).toEqual(["OK 0 package(s)"]);
  });

  it("prints usage and fails without a command", () => {
    const { code, err } = runCli([]);
    expect(code).toBe(1);
    expect(err[0]).toContain("Usage");
  });
});
