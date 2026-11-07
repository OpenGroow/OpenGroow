import { describe, expect, it, vi } from "vitest";
import { fetchHubIndex, fetchHubPackageIndex, hubIndexUrl, hubPackageIndexPath, parseHubIndex, parseHubPackageIndex } from "./hub-index.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const entry = {
  id: "@opengroow/seo",
  name: "SEO",
  description: "Keyword research",
  repository: "opengroow/seo-agent",
  tag: "v1.2.0",
  digest: DIGEST,
  category: "marketing",
  verification: "official",
};
const index = (packages: unknown[] = [entry]) => ({ schemaVersion: 1, packages });

describe("parseHubIndex", () => {
  it("accepts an index and keeps each entry's trust level", () => {
    const community = { ...entry, id: "@alice/x", verification: "community" };
    expect(parseHubIndex(index([entry, community]))).toEqual({
      ok: true,
      index: { schemaVersion: 1, packages: [entry, community] },
    });
  });

  it("accepts an optional release asset and a tag containing @", () => {
    const withAsset = { ...entry, tag: "seo@1.2.0", asset: "seo-1.2.0.tgz" };
    expect(parseHubIndex(index([withAsset]))).toEqual({ ok: true, index: { schemaVersion: 1, packages: [withAsset] } });
  });

  it.each([
    ["an asset that is not a .tgz", index([{ ...entry, asset: "seo.zip" }]), /asset/],
    ["an asset with a path", index([{ ...entry, asset: "../seo.tgz" }]), /asset/],
    ["a non-string asset", index([{ ...entry, asset: 3 }]), /asset/],
  ])("refuses %s", (_label, input, message) => {
    const parsed = parseHubIndex(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(message);
  });

  it.each([
    ["an unknown top-level key", { ...index(), extra: 1 }, /extra/],
    ["an unknown entry key", index([{ ...entry, signature: "x" }]), /signature/],
    ["a missing digest", index([{ ...entry, digest: undefined }]), /digest/],
    ["a malformed digest", index([{ ...entry, digest: "sha1:abc" }]), /digest/],
    ["an unknown verification level", index([{ ...entry, verification: "trusted" }]), /verification/],
    ["an unscoped id", index([{ ...entry, id: "seo" }]), /id/],
    ["a non-GitHub repository", index([{ ...entry, repository: "https://evil.example/a/b" }]), /repository/],
    ["an invalid tag", index([{ ...entry, tag: "../x" }]), /tag/],
    ["an unsupported schema version", { ...index(), schemaVersion: 2 }, /schemaVersion/],
    ["a duplicated id", index([entry, entry]), /duplicate/i],
    ["a non-object", "nope", /object/],
    ["a verified entry claiming the reserved @opengroow scope", index([{ ...entry, verification: "verified" }]), /@opengroow/],
  ])("refuses %s", (_label, input, message) => {
    const result = parseHubIndex(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(message);
  });
});

describe("fetchHubIndex", () => {
  it("reads index.json of the configured hub repository", async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(index())));
    const result = await fetchHubIndex({ repository: "https://github.com/acme/hub", ref: "main", fetch });
    expect(fetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/acme/hub/main/index.json");
    expect(result.packages[0]?.id).toBe("@opengroow/seo");
    expect(hubIndexUrl("acme/hub", "v2")).toBe("https://raw.githubusercontent.com/acme/hub/v2/index.json");
  });

  it("fails with the reason when the hub is unreachable or its index invalid", async () => {
    const hub = (fetch: () => Promise<Response>) => fetchHubIndex({ repository: "acme/hub", ref: "main", fetch });
    await expect(hub(async () => new Response(null, { status: 404 }))).rejects.toThrow(/HTTP 404/);
    await expect(hub(async () => new Response("{not json"))).rejects.toThrow(/not valid JSON/);
    await expect(hub(async () => new Response(JSON.stringify({ schemaVersion: 1 })))).rejects.toThrow(/packages/);
  });
});

describe("hub package indexes (ADR-072)", () => {
  const { category: _category, ...publisher } = {
    ...entry,
    id: "@opengroow/publisher-postiz",
    name: "Postiz",
    tag: "publisher-postiz@1.0.0",
    asset: "opengroow-publisher-postiz-1.0.0.tgz",
  };

  it("lives in its own file, so the Template index never carries a new kind of entry", () => {
    expect(hubPackageIndexPath("publisher")).toBe("publishers.json");
    // The Template reader refuses any key it does not know: this is what would break every deployed OpenGroow.
    expect(parseHubIndex(index([{ ...publisher, kind: "publisher" }])).ok).toBe(false);
  });

  it("accepts entries without a category and keeps their trust level", () => {
    const parsed = parseHubPackageIndex(index([publisher]));
    expect(parsed).toEqual({ ok: true, index: { schemaVersion: 1, packages: [publisher] } });
  });

  it("applies the same strictness: unknown keys, digest, duplicates, reserved scope", () => {
    expect(parseHubPackageIndex(index([{ ...publisher, category: "x" }]))).toEqual({ ok: false, reason: 'packages[0]: unknown key "category"' });
    expect(parseHubPackageIndex(index([{ ...publisher, digest: "sha256:zz" }])).ok).toBe(false);
    expect(parseHubPackageIndex(index([publisher, publisher]))).toEqual({ ok: false, reason: "Duplicate entry for @opengroow/publisher-postiz" });
    expect(parseHubPackageIndex(index([{ ...publisher, verification: "community" }])).ok).toBe(false);
  });

  it("reads publishers.json of the configured hub repository", async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(index([publisher]))));
    const result = await fetchHubPackageIndex({ repository: "acme/hub", ref: "main", kind: "publisher", fetch });
    expect(fetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/acme/hub/main/publishers.json");
    expect(result.packages[0]?.id).toBe("@opengroow/publisher-postiz");
    await expect(
      fetchHubPackageIndex({ repository: "acme/hub", ref: "main", kind: "publisher", fetch: async () => new Response(null, { status: 404 }) }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
