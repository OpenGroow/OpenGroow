import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { checkPublisherFolder, packPublisher } from "./publisher.js";

// The Postiz copy the core's tests use: a complete, valid Publisher package.
const POSTIZ = resolve(__dirname, "../../../apps/convex/test/postiz-reference");

function copyOfPostiz() {
  const dir = mkdtempSync(join(tmpdir(), "groowhub-cli-"));
  cpSync(POSTIZ, dir, { recursive: true, filter: (src) => !src.includes("node_modules") });
  return dir;
}

describe("checkPublisherFolder", () => {
  it("accepts a valid package", () => {
    expect(checkPublisherFolder(POSTIZ).manifest).toMatchObject({ id: "postiz", contractVersion: 1 });
  });

  it("names the package convention when the name does not follow the manifest", () => {
    const dir = copyOfPostiz();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@opengroow/other", version: "1.0.0" }));
    expect(() => checkPublisherFolder(dir)).toThrow("expected the name publisher-postiz");
  });

  it("refuses a manifest of another contract version", () => {
    const dir = copyOfPostiz();
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, contractVersion: 2 }));
    expect(() => checkPublisherFolder(dir)).toThrow(/contract/i);
  });

  it("refuses a malformed channel-options.json", () => {
    const dir = copyOfPostiz();
    writeFileSync(join(dir, "data/channel-options.json"), JSON.stringify({ platforms: {} }));
    expect(() => checkPublisherFolder(dir)).toThrow("data/channel-options.json must be");
  });

  it("names a missing file", () => {
    const dir = copyOfPostiz();
    execFileSync("rm", [join(dir, "data/channel-options.json")]);
    expect(() => checkPublisherFolder(dir)).toThrow("data/channel-options.json is missing");
  });
});

describe("packPublisher", () => {
  it("packs the bundle, manifest and data, and writes the index entry on request", () => {
    const out = mkdtempSync(join(tmpdir(), "groowhub-out-"));
    const indexFile = join(out, "publishers.json");
    const result = packPublisher(POSTIZ, join(out, "dist"), { indexFile });
    const files = execFileSync("tar", ["-tzf", result.file]).toString();
    for (const f of ["package/dist/plugin.mjs", "package/manifest.json", "package/data/capabilities.json", "package/data/channel-options.json", "package/package.json"]) {
      expect(files).toContain(f);
    }
    expect(result.tag).toBe("publisher-postiz@1.0.0");
    const index = JSON.parse(readFileSync(indexFile, "utf-8"));
    expect(index.packages[0]).toMatchObject({ id: "@opengroow/publisher-postiz", tag: result.tag, asset: result.asset, digest: result.digest, verification: "official" });
  });
});

describe("the publisher commands", () => {
  const io = (cwd: string) => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { cwd, log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
  };

  it("validate publisher and validate index --kind publisher", () => {
    const a = io(process.cwd());
    expect(run(["validate", "publisher", POSTIZ], a.io)).toBe(0);
    expect(a.out[0]).toBe("OK @opengroow/publisher-postiz@1.0.0");

    const dir = mkdtempSync(join(tmpdir(), "groowhub-idx-"));
    writeFileSync(join(dir, "publishers.json"), JSON.stringify({ schemaVersion: 1, packages: [] }));
    const b = io(dir);
    expect(run(["validate", "index", "publishers.json", "--kind", "publisher"], b.io)).toBe(0);
  });

  it("reports a broken package", () => {
    const dir = copyOfPostiz();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@opengroow/other", version: "1.0.0" }));
    const a = io(process.cwd());
    expect(run(["validate", "publisher", dir], a.io)).toBe(1);
    expect(a.err[0]).toContain("ERROR");
  });
});
