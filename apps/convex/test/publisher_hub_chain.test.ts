// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { loadPlugin } from "../publisher/load_node";
import { packPublisher } from "../../../packages/publisher-sdk/scripts/pack-publisher";
import { createHubServer } from "../../../scripts/hub-serve.mjs";

// The whole local circuit of ADR-072, with nothing stubbed but Postiz itself:
// pack the Postiz package into a hub folder, serve it over HTTP, list and
// install it through the Convex actions (real fetch, real digest check), then
// load the stored bundle and call it.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../hub_packages.ts": () => import("../hub_packages.js"),
  "../hub_packages_node.ts": () => import("../hub_packages_node.js"),
  "../publisher_packages.ts": () => import("../publisher_packages.js"),
};
const USER = { name: "U", email: "u@e.com", tokenIdentifier: "test|chain", subject: "user-chain" };
const PACKAGE_ID = "@opengroow/publisher-postiz";

let hubDir: string;
let server: ReturnType<typeof createHubServer>;
let hubUrl: string;

beforeAll(async () => {
  hubDir = mkdtempSync(join(tmpdir(), "hub-chain-"));
  packPublisher(join(__dirname, "postiz-reference"), hubDir);
  server = createHubServer(hubDir);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(hubDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("pack -> serve -> install -> load -> call", () => {
  it("installs the packed Postiz package from the local hub and runs it", async () => {
    vi.stubEnv("OPENGROOW_HUB_URL", hubUrl);
    const t = convexTest(schema, modules);
    const user = t.withIdentity(USER);

    // Add publisher: the hub's catalogue.
    const catalogue = await user.action(api.hub_packages_node.catalogue, { kind: "publisher" });
    expect(catalogue).toEqual({ entries: [expect.objectContaining({ packageId: PACKAGE_ID, name: "Postiz", verification: "official" })] });

    // Choosing Postiz installs it: digest verified, package validated, data derived.
    const installed = await user.action(api.hub_packages_node.install, { kind: "publisher", packageId: PACKAGE_ID });
    expect(installed).toEqual({ status: "installed", packageId: PACKAGE_ID, version: "1.0.0" });
    const list = await user.query(api.publisher_packages.list, {});
    expect(list).toEqual([expect.objectContaining({ adapter: "postiz", name: "Postiz", postUrl: "{url}/p/{id}" })]);
    expect(list[0]!.capabilities.platforms.instagram).toBeDefined();

    // The core loads the stored bundle and the plugin talks to Postiz.
    const bundle = await t.query(internal.publisher_packages.bundleOf, { adapter: "postiz" });
    const plugin = await loadPlugin({ runQuery: async () => bundle } as never, "postiz");
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/is-connected") ? new Response(JSON.stringify({ connected: true })) : realFetch(url))));
    try {
      expect(await plugin.testConnection({ url: "https://postiz.example.com", apiKey: "k" })).toEqual({ ok: true });
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  });

  it("refuses a release whose file was changed after the index was written", async () => {
    vi.stubEnv("OPENGROOW_HUB_URL", hubUrl);
    const { writeFileSync, readFileSync } = await import("node:fs");
    const asset = join(hubDir, "dist", "opengroow-publisher-postiz-1.0.0.tgz");
    const original = readFileSync(asset);
    writeFileSync(asset, Buffer.concat([original, Buffer.from("tampered")]));
    try {
      const t = convexTest(schema, modules);
      const result = await t.withIdentity(USER).action(api.hub_packages_node.install, { kind: "publisher", packageId: PACKAGE_ID });
      expect(result).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/Digest mismatch/) });
      expect(await t.query(internal.hub_packages.get, { packageId: PACKAGE_ID })).toBeNull();
    } finally {
      writeFileSync(asset, original);
    }
  });
});
