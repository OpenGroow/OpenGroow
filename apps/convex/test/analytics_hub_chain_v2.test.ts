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

// Seam 1 (ADR-079): the hub chain for an Analytics Adapter of contract 2, with a test adapter.
// What the core knows after install is the declaration of the manifest, not code.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../hub_packages.ts": () => import("../hub_packages.js"),
  "../hub_packages_node.ts": () => import("../hub_packages_node.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
};
const USER = { name: "U", email: "u@e.com", tokenIdentifier: "test|chain2", subject: "user-chain2" };
const PACKAGE_ID = "@opengroow/analytics-demo-metrics";

let hubDir: string;
let server: ReturnType<typeof createHubServer>;

beforeAll(async () => {
  hubDir = mkdtempSync(join(tmpdir(), "analytics-chain2-"));
  packAnalytics(join(__dirname, "demo_analytics_v2_reference"), join(hubDir, "dist"), { indexFile: join(hubDir, "analytics.json") });
  server = createHubServer(hubDir);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("OPENGROOW_HUB_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(hubDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("a contract 2 adapter through the hub", () => {
  it("installs with its declared metrics, main metric, delays and connection needs", async () => {
    const t = convexTest(schema, modules);
    const installed = await t.withIdentity(USER).action(api.hub_packages_node.install, { kind: "analytics", packageId: PACKAGE_ID });
    expect(installed).toEqual({ status: "installed", packageId: PACKAGE_ID, version: "1.0.0" });

    const [adapter] = await t.run((ctx) => installedAnalyticsAdapters(ctx));
    expect(adapter).toMatchObject({
      id: "demo-metrics",
      primary: "clicks",
      collect: ["3d", "7d", "28d"],
      needsUrl: false,
      secret: { kind: "json", fields: ["client_email", "private_key"] },
    });
    expect(adapter.metrics?.map((m) => m.key)).toEqual(["clicks", "impressions", "ctr", "position"]);
    expect(adapter.metrics?.find((m) => m.key === "position")).toMatchObject({ better: "lower" });

    // The stored bundle loads (contract 2 is accepted) and reads.
    const bundle = await t.query(internal.analytics_adapters.bundleOf, { adapter: "demo-metrics" });
    const loaded = await loadAnalyticsAdapter({ runQuery: async () => bundle } as never, "demo-metrics");
    expect(loaded).toMatchObject({ id: "demo-metrics", contractVersion: 2 });
  });
});
