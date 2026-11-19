// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { loadAnalyticsAdapter } from "../analytics/load_node";
import { installedAnalyticsAdapters } from "../analytics_adapters";
import { packAnalytics } from "../../../packages/groowhub-cli/src/analytics";
import { createHubServer } from "../../../scripts/hub-serve.mjs";
import instagram from "./postiz_reference/fixtures/analytics-post-instagram.json";

// Seam 2: the local circuit of ADR-072 for the Analytics Adapter kind (ADR-078),
// with nothing stubbed but Postiz itself: pack the Postiz analytics package into
// a hub folder, serve it over HTTP, list and install it through the Convex
// actions (real fetch, real digest check), then load the stored bundle and read.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../hub_packages.ts": () => import("../hub_packages.js"),
  "../hub_packages_node.ts": () => import("../hub_packages_node.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
};
const USER = { name: "U", email: "u@e.com", tokenIdentifier: "test|chain", subject: "user-chain" };
const PACKAGE_ID = "@opengroow/analytics-postiz";

let hubDir: string;
let server: ReturnType<typeof createHubServer>;
let hubUrl: string;

beforeAll(async () => {
  hubDir = mkdtempSync(join(tmpdir(), "analytics-chain-"));
  packAnalytics(join(__dirname, "postiz_analytics_reference"), join(hubDir, "dist"), { indexFile: join(hubDir, "analytics.json") });
  server = createHubServer(hubDir);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(hubDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("pack -> serve -> install -> load -> read", () => {
  it("installs the packed Postiz Analytics Adapter from the local hub and reads a post with it", async () => {
    vi.stubEnv("OPENGROOW_HUB_URL", hubUrl);
    const t = convexTest(schema, modules);
    const user = t.withIdentity(USER);

    const catalogue = await user.action(api.hub_packages_node.catalogue, { kind: "analytics" });
    expect(catalogue).toEqual({ entries: [expect.objectContaining({ packageId: PACKAGE_ID, name: "Postiz", verification: "official" })] });

    const installed = await user.action(api.hub_packages_node.install, { kind: "analytics", packageId: PACKAGE_ID });
    expect(installed).toEqual({ status: "installed", packageId: PACKAGE_ID, version: "1.0.0" });

    // What the core knows without running the code: id, key, Publisher, delay, options.
    const adapters = await t.run((ctx) => installedAnalyticsAdapters(ctx));
    expect(adapters).toEqual([
      expect.objectContaining({
        id: "postiz",
        name: "Postiz",
        needs: "externalId",
        publisher: "postiz",
        earliestDelayMs: 3_600_000,
        options: [expect.objectContaining({ key: "lookbackDays", default: 7 })],
        primary: "views",
      }),
    ]);
    // Contract 2 (ADR-079): the seven metrics in column order, engagement derived and never stored.
    expect(adapters[0]?.metrics?.map((m) => m.key)).toEqual(["views", "likes", "comments", "engagement", "reach", "shares", "saves"]);
    expect(adapters[0]?.metrics?.find((m) => m.key === "engagement")).toMatchObject({
      type: "level",
      format: "percent",
      derive: { sum: ["likes", "comments", "shares", "saves"], per: "views" },
    });

    // The core loads the stored bundle and the adapter reads Postiz.
    const bundle = await t.query(internal.analytics_adapters.bundleOf, { adapter: "postiz" });
    const adapter = await loadAnalyticsAdapter({ runQuery: async () => bundle } as never, "postiz");
    expect(adapter).toMatchObject({ id: "postiz", needs: "externalId" });
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/analytics/post/") ? new Response(JSON.stringify(instagram)) : realFetch(url))));
    try {
      const result = await adapter!.read(
        { url: "https://postiz.example.com", apiKey: "k", options: { lookbackDays: 7 } },
        { externalId: "post-1", kind: "social", publishedAt: Date.now() },
      );
      expect(result).toEqual({ ok: true, reading: { status: "taken", metrics: { views: 23, reach: 23, saves: 0, likes: 0, comments: 0, shares: 0 } } });
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  });

  it("refuses a release whose file was changed after the index was written", async () => {
    vi.stubEnv("OPENGROOW_HUB_URL", hubUrl);
    const { writeFileSync, readFileSync } = await import("node:fs");
    const asset = join(hubDir, "dist", "opengroow-analytics-postiz-1.0.0.tgz");
    const original = readFileSync(asset);
    writeFileSync(asset, Buffer.concat([original, Buffer.from("tampered")]));
    try {
      const t = convexTest(schema, modules);
      const result = await t.withIdentity(USER).action(api.hub_packages_node.install, { kind: "analytics", packageId: PACKAGE_ID });
      expect(result).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/Digest mismatch/) });
    } finally {
      writeFileSync(asset, original);
    }
  });
});
