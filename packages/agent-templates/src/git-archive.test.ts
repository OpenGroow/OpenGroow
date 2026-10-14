import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { tarGz } from "./__fixtures__/tar-gz.js";
import { fetchGitPackage, githubArchiveUrl, githubAssetUrl, isValidGitAsset, isValidGitTag } from "./git-archive.js";

const sha = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const fetchOf = (body: Buffer, status = 200) =>
  vi.fn(async (_url: string) => new Response(status === 200 ? new Uint8Array(body) : null, { status }));

const archive = tarGz([
  { name: "seo-1.0.0/", type: "5" },
  { name: "seo-1.0.0/CLAW.md", content: "# claw" },
  { name: "seo-1.0.0/workspace/AGENTS.md", content: "agents" },
  { name: "pax_global_header", type: "g", content: "52 comment=abc\n" },
]);

describe("githubArchiveUrl", () => {
  it("accepts owner/repo and https URLs", () => {
    const expected = "https://github.com/acme/seo/archive/refs/tags/v1.0.0.tar.gz";
    expect(githubArchiveUrl("acme/seo", "v1.0.0")).toBe(expected);
    expect(githubArchiveUrl("https://github.com/acme/seo.git", "v1.0.0")).toBe(expected);
  });
  it("refuses anything that is not a GitHub repository", () => {
    expect(() => githubArchiveUrl("https://evil.example/acme/seo", "v1")).toThrow(/GitHub/);
    expect(() => githubArchiveUrl("acme/seo", "../x")).toThrow(/tag/);
  });
});

describe("fetchGitPackage", () => {
  it("downloads the release archive and returns its files without the top-level folder", async () => {
    const fetch = fetchOf(archive);
    const result = await fetchGitPackage({ repository: "acme/seo", tag: "v1.0.0", digest: sha(archive), fetch });
    expect(fetch).toHaveBeenCalledWith("https://github.com/acme/seo/archive/refs/tags/v1.0.0.tar.gz");
    expect(result.files).toEqual([
      { path: "CLAW.md", content: "# claw" },
      { path: "workspace/AGENTS.md", content: "agents" },
    ]);
    expect(result.gitOrigin).toEqual({ repository: "https://github.com/acme/seo", tag: "v1.0.0", archiveDigest: sha(archive) });
  });

  it("reads paths over 100 bytes from pax headers (as `git archive` writes them) and drops ignored entries", async () => {
    const long = `seo-1.0.0/workspace/${"deep/".repeat(20)}NOTES.md`;
    const withLong = tarGz([
      { name: "seo-1.0.0/CLAW.md", content: "# claw" },
      { name: "PaxHeader", type: "x", pax: { path: long } },
      { name: long, content: "notes" },
      { name: "seo-1.0.0/node_modules/x/index.js", content: "x" },
    ]);
    const result = await fetchGitPackage({ repository: "acme/seo", tag: "v1.0.0", digest: sha(withLong), fetch: fetchOf(withLong) });
    expect(result.files).toEqual([
      { path: "CLAW.md", content: "# claw" },
      { path: long.slice("seo-1.0.0/".length), content: "notes" },
    ]);
  });

  it("refuses an archive whose sha256 differs from the expected digest", async () => {
    await expect(
      fetchGitPackage({ repository: "acme/seo", tag: "v1.0.0", digest: `sha256:${"0".repeat(64)}`, fetch: fetchOf(archive) }),
    ).rejects.toThrow(/digest mismatch/i);
  });

  it("reports a failed download", async () => {
    await expect(
      fetchGitPackage({ repository: "acme/seo", tag: "v1.0.0", digest: sha(archive), fetch: fetchOf(archive, 404) }),
    ).rejects.toThrow(/404/);
  });

  it("refuses links and path traversal in the archive", async () => {
    for (const entry of [
      { name: "r/link", type: "2", linkname: "/etc/passwd" },
      { name: "r/../../evil", content: "x" },
    ]) {
      const bad = tarGz([{ name: "r/CLAW.md", content: "c" }, entry]);
      await expect(
        fetchGitPackage({ repository: "acme/seo", tag: "v1", digest: sha(bad), fetch: fetchOf(bad) }),
      ).rejects.toThrow(/refus/i);
    }
  });

  it("refuses a binary file instead of silently corrupting it", async () => {
    const bad = tarGz([
      { name: "r/CLAW.md", content: "c" },
      { name: "r/logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]) },
    ]);
    await expect(
      fetchGitPackage({ repository: "acme/seo", tag: "v1", digest: sha(bad), fetch: fetchOf(bad) }),
    ).rejects.toThrow(/UTF-8 text/);
  });

  it("requires a well-formed digest", async () => {
    await expect(fetchGitPackage({ repository: "acme/seo", tag: "v1", digest: "abc", fetch: fetchOf(archive) })).rejects.toThrow(/sha256:/);
  });
});

describe("release asset packages (#672)", () => {
  const assetArchive = tarGz([
    { name: "package/CLAW.md", content: "# claw" },
    { name: "package/workspace/AGENTS.md", content: "agents" },
  ]);

  it("builds the release asset URL, with @ allowed in the tag", () => {
    expect(githubAssetUrl("OpenGroow/groowhub", "source@1.2.0", "source-1.2.0.tgz")).toBe(
      "https://github.com/OpenGroow/groowhub/releases/download/source@1.2.0/source-1.2.0.tgz",
    );
  });

  it("accepts @ inside a tag but not at its start or as a path escape", () => {
    expect(isValidGitTag("seo@1.2.0")).toBe(true);
    expect(isValidGitTag("@seo")).toBe(false);
    expect(isValidGitTag("a@..")).toBe(false);
  });

  it.each(["seo-1.0.0.tgz", "seo_1.0.0.tgz", "a.b-c.tgz"])("accepts the asset name %s", (name) => {
    expect(isValidGitAsset(name)).toBe(true);
  });
  it.each(["seo.zip", "../seo.tgz", "a/b.tgz", ".tgz", "seo.tgz?x=1", "seo 1.tgz", "a..b.tgz", ""])("refuses the asset name %j", (name) => {
    expect(isValidGitAsset(name)).toBe(false);
  });

  it("downloads the asset instead of the tag archive and strips the package/ folder", async () => {
    const fetch = fetchOf(assetArchive);
    const result = await fetchGitPackage({
      repository: "OpenGroow/groowhub",
      tag: "source@1.0.0",
      asset: "source-1.0.0.tgz",
      digest: sha(assetArchive),
      fetch,
    });
    expect(fetch).toHaveBeenCalledWith("https://github.com/OpenGroow/groowhub/releases/download/source@1.0.0/source-1.0.0.tgz");
    expect(result.files).toEqual([
      { path: "CLAW.md", content: "# claw" },
      { path: "workspace/AGENTS.md", content: "agents" },
    ]);
    expect(result.gitOrigin).toEqual({
      repository: "https://github.com/OpenGroow/groowhub",
      tag: "source@1.0.0",
      asset: "source-1.0.0.tgz",
      archiveDigest: sha(assetArchive),
    });
  });

  it("refuses an asset whose sha256 differs from the expected digest", async () => {
    await expect(
      fetchGitPackage({ repository: "a/b", tag: "x@1", asset: "x-1.tgz", digest: `sha256:${"0".repeat(64)}`, fetch: fetchOf(assetArchive) }),
    ).rejects.toThrow(/digest mismatch/i);
  });

  it("refuses a bad asset name before any download", async () => {
    const fetch = fetchOf(assetArchive);
    await expect(
      fetchGitPackage({ repository: "a/b", tag: "x@1", asset: "../evil.tgz", digest: sha(assetArchive), fetch }),
    ).rejects.toThrow(/asset/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
