// @vitest-environment node
import path from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { loadPlugin } from "../publisher/load_node";

// The real loader (ADR-072) against a real bundle of the Postiz plugin, built
// the way a hub release builds it. Node environment: the loader is a Node
// action's code and evaluates the bundle with a data: import.

const entry = path.resolve(__dirname, "postiz_reference/src/index.ts");
const bundle = (source?: string) =>
  source ??
  buildSync({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], target: "es2022", write: false })
    .outputFiles[0]!.text;

const MANIFEST = JSON.stringify({ id: "postiz", name: "Postiz", contractVersion: 1, postUrl: "{url}/p/{id}" });
const SOURCE = bundle();

const ctxReturning = (row: unknown) => {
  const runQuery = vi.fn(async () => row);
  return { ctx: { runQuery } as never, runQuery };
};
const row = (over: Record<string, unknown> = {}) => ({ packageId: "@opengroow/publisher-postiz", digest: "sha256:a", source: SOURCE, manifest: MANIFEST, ...over });

describe("loadPlugin", () => {
  it("loads the plugin from the stored bundle and it works", async () => {
    const { ctx } = ctxReturning(row({ digest: "sha256:works" }));
    const plugin = await loadPlugin(ctx, "postiz");
    expect(plugin.id).toBe("postiz");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ connected: true }))));
    try {
      expect(await plugin.testConnection({ url: "https://p.example.com", apiKey: "k" })).toEqual({ ok: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("evaluates a package once per digest, and again after an upgrade", async () => {
    const first = await loadPlugin(ctxReturning(row({ digest: "sha256:v1" })).ctx, "postiz");
    expect(await loadPlugin(ctxReturning(row({ digest: "sha256:v1" })).ctx, "postiz")).toBe(first);
    // An upgrade changes the bundle (and so its digest): the new source is evaluated, not the cached module.
    const upgraded = await loadPlugin(ctxReturning(row({ digest: "sha256:v2", source: `${SOURCE}\n// v2` })).ctx, "postiz");
    expect(upgraded).not.toBe(first);
  });

  it("fails clearly when the Publisher is not installed", async () => {
    await expect(loadPlugin(ctxReturning(null).ctx, "postiz")).rejects.toThrow('The Publisher "postiz" is not installed');
  });

  it.each([
    ["an unreadable manifest", { manifest: "{nope", digest: "sha256:e1" }, /unreadable manifest/],
    ["a manifest for another contract", { manifest: JSON.stringify({ id: "postiz", name: "Postiz", contractVersion: 9 }), digest: "sha256:e2" }, /contract 9/],
    ["a bundle that does not evaluate", { source: "export default {", digest: "sha256:e3" }, /could not be loaded/],
    ["a bundle with no default export", { source: "export const x = 1;", digest: "sha256:e4" }, /no default export/],
    ["a bundle of another Publisher", { source: "export default { id: 'other' };", digest: "sha256:e5" }, /plugin "other", the manifest declares "postiz"/],
    ["a bundle missing functions", { source: "export default { id: 'postiz', contractVersion: 1 };", digest: "sha256:e6" }, /lacks testConnection/],
  ])("refuses %s with a clear message", async (_name, over, message) => {
    await expect(loadPlugin(ctxReturning(row(over)).ctx, "postiz")).rejects.toThrow(message);
  });
});
