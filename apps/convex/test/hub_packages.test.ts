import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { tarGz } from "../../../packages/agent-templates/src/__fixtures__/tar-gz";
import type { PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../hub_packages.ts": () => import("../hub_packages.js"),
  "../hub_packages_node.ts": () => import("../hub_packages_node.js"),
};

const USER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|hp", subject: "owner-hp" };
const sha = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

const MANIFEST = { id: "postiz", name: "Postiz", contractVersion: 1, postUrl: "{url}/p/{id}" };
const CAPABILITIES = { schemaVersion: 1, adapter: "postiz", platforms: { instagram: { name: "Instagram", video: "supported", image: "supported", carousel: "supported" } } };
const OPTIONS = { schemaVersion: 1, adapter: "postiz", platforms: {} };

const publisherFiles = (over: Record<string, string | null> = {}): PackageFile[] => {
  const base: Record<string, string> = {
    "package.json": JSON.stringify({ name: "@opengroow/publisher-postiz", version: "1.0.0" }),
    "manifest.json": JSON.stringify(MANIFEST),
    "data/capabilities.json": JSON.stringify(CAPABILITIES),
    "data/channel-options.json": JSON.stringify(OPTIONS),
    "dist/plugin.mjs": "export const postizPlugin = {};",
  };
  return Object.entries({ ...base, ...over })
    .filter(([, content]) => content !== null)
    .map(([path, content]) => ({ path, content: content as string }));
};
// An `npm pack` tarball: every file under `package/`.
const tgz = (files: PackageFile[]) => tarGz(files.map((f) => ({ name: `package/${f.path}`, content: f.content })));

const TAG = "publisher-postiz@1.0.0";
const ASSET = "opengroow-publisher-postiz-1.0.0.tgz";
const assetUrl = (tag = TAG, asset = ASSET) => `https://github.com/acme/hub/releases/download/${tag}/${asset}`;

const entry = (archive: Buffer, extra: Record<string, unknown> = {}) => ({
  id: "@opengroow/publisher-postiz",
  name: "Postiz",
  description: "Publish through a Postiz instance",
  repository: "acme/hub",
  tag: TAG,
  asset: ASSET,
  digest: sha(archive),
  verification: "official",
  ...extra,
});

/** The network: publishers.json and the release assets. Anything else is a 404 (index.json included: it is never read). */
function stubNetwork(packages: unknown[], assets: Record<string, Buffer> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://raw.githubusercontent.com/acme/hub/main/publishers.json") {
      return new Response(JSON.stringify({ schemaVersion: 1, packages }));
    }
    const asset = assets[url];
    return asset ? new Response(new Uint8Array(asset)) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("OPENGROOW_HUB_REPOSITORY", "acme/hub");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hub_packages_node.catalogue", () => {
  it("lists the packages of a kind from its own index", async () => {
    const archive = tgz(publisherFiles());
    stubNetwork([entry(archive)]);
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(USER).action(api.hub_packages_node.catalogue, { kind: "publisher" });
    expect(result).toEqual({
      entries: [{ packageId: "@opengroow/publisher-postiz", name: "Postiz", description: "Publish through a Postiz instance", tag: TAG, verification: "official" }],
    });
  });

  it("reports an unreachable hub instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(USER).action(api.hub_packages_node.catalogue, { kind: "publisher" });
    expect(result.entries).toEqual([]);
    expect(result.error).toMatch(/HTTP 500/);
  });

  it("requires a signed-in user", async () => {
    stubNetwork([]);
    const t = convexTest(schema, modules);
    await expect(t.action(api.hub_packages_node.catalogue, { kind: "publisher" })).rejects.toThrow(/Authentication required/);
  });
});

describe("hub_packages_node.install", () => {
  const install = (t: ReturnType<typeof convexTest>) =>
    t.withIdentity(USER).action(api.hub_packages_node.install, { kind: "publisher", packageId: "@opengroow/publisher-postiz" });

  it("verifies the digest, stores the package and its files, and reports the version", async () => {
    const archive = tgz(publisherFiles());
    stubNetwork([entry(archive)], { [assetUrl()]: archive });
    const t = convexTest(schema, modules);

    expect(await install(t)).toEqual({ status: "installed", packageId: "@opengroow/publisher-postiz", version: "1.0.0" });

    const stored = await t.query(internal.hub_packages.get, { packageId: "@opengroow/publisher-postiz" });
    expect(stored).toMatchObject({ kind: "publisher", version: "1.0.0", tag: TAG, digest: sha(archive), verification: "official" });
    expect(stored!.files.map((f) => f.path).sort()).toEqual(
      ["data/capabilities.json", "data/channel-options.json", "dist/plugin.mjs", "manifest.json", "package.json"],
    );
    expect(stored!.files.find((f) => f.path === "dist/plugin.mjs")!.content).toBe("export const postizPlugin = {};");
    expect(await t.withIdentity(USER).query(api.hub_packages.installed, { kind: "publisher" })).toEqual([
      expect.objectContaining({ packageId: "@opengroow/publisher-postiz", version: "1.0.0" }),
    ]);
  });

  it("refuses a release whose digest differs from the index, storing nothing", async () => {
    const archive = tgz(publisherFiles());
    const tampered = tgz(publisherFiles({ "dist/plugin.mjs": "export const evil = 1;" }));
    stubNetwork([entry(archive)], { [assetUrl()]: tampered });
    const t = convexTest(schema, modules);
    const result = await install(t);
    expect(result).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/Digest mismatch/) });
    expect(await t.query(internal.hub_packages.get, { packageId: "@opengroow/publisher-postiz" })).toBeNull();
  });

  it("installs only official packages, because their code runs inside OpenGroow", async () => {
    const archive = tgz(publisherFiles());
    stubNetwork([entry(archive, { verification: "community", id: "@alice/publisher-postiz" })], { [assetUrl()]: archive });
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(USER).action(api.hub_packages_node.install, { kind: "publisher", packageId: "@alice/publisher-postiz" });
    expect(result).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/only official packages/) });
  });

  it("refuses an id the hub does not list", async () => {
    stubNetwork([]);
    const t = convexTest(schema, modules);
    expect(await install(t)).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/not listed in the hub/) });
  });

  it.each([
    ["no manifest", { "manifest.json": null }, /manifest\.json is missing/],
    ["a manifest for another contract version", { "manifest.json": JSON.stringify({ ...MANIFEST, contractVersion: 2 }) }, /contract 2/],
    ["a manifest that claims another Publisher", { "manifest.json": JSON.stringify({ ...MANIFEST, id: "other" }) }, /declares the Publisher "other"/],
    ["no bundle", { "dist/plugin.mjs": null }, /dist\/plugin\.mjs is missing/],
    ["an empty bundle", { "dist/plugin.mjs": "  " }, /dist\/plugin\.mjs is missing or empty/],
    ["no capabilities", { "data/capabilities.json": null }, /capabilities\.json is missing/],
    ["invalid capabilities", { "data/capabilities.json": JSON.stringify({ schemaVersion: 9 }) }, /capabilities\.json/],
    ["malformed channel options", { "data/channel-options.json": "{}" }, /channel-options\.json must be/],
  ])("refuses a package with %s, storing nothing", async (_name, over, message) => {
    const archive = tgz(publisherFiles(over as Record<string, string | null>));
    stubNetwork([entry(archive)], { [assetUrl()]: archive });
    const t = convexTest(schema, modules);
    expect(await install(t)).toMatchObject({ status: "error", errorMessage: expect.stringMatching(message) });
    expect(await t.query(internal.hub_packages.get, { packageId: "@opengroow/publisher-postiz" })).toBeNull();
  });

  it("replaces the installed version and its files when installed again (an upgrade)", async () => {
    const v1 = tgz(publisherFiles());
    const files2 = publisherFiles({ "dist/plugin.mjs": "export const postizPlugin = { v: 2 };", "data/extra.json": "{}" });
    const v2 = tgz(files2);
    const tag2 = "publisher-postiz@1.1.0";
    const asset2 = "opengroow-publisher-postiz-1.1.0.tgz";
    const t = convexTest(schema, modules);

    stubNetwork([entry(v1)], { [assetUrl()]: v1 });
    await install(t);
    stubNetwork([entry(v2, { tag: tag2, asset: asset2 })], { [assetUrl(tag2, asset2)]: v2 });
    expect(await install(t)).toMatchObject({ status: "installed", version: "1.1.0" });

    const stored = await t.query(internal.hub_packages.get, { packageId: "@opengroow/publisher-postiz" });
    expect(stored!.version).toBe("1.1.0");
    expect(stored!.files.find((f) => f.path === "dist/plugin.mjs")!.content).toContain("v: 2");
    expect(stored!.files).toHaveLength(6);
    expect(await t.run(async (ctx) => (await ctx.db.query("hubPackages").collect()).length)).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("hubPackageFiles").collect()).length)).toBe(6);
  });

  it("requires a signed-in user", async () => {
    stubNetwork([]);
    const t = convexTest(schema, modules);
    await expect(t.action(api.hub_packages_node.install, { kind: "publisher", packageId: "@opengroow/publisher-postiz" })).rejects.toThrow(/Authentication required/);
  });
});
