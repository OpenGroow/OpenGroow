import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildConvexRunGitArgs, installFromGit, parseTemplateAddGitArgs } from "../scripts/template-add-git.js";
import { tarGz } from "./__fixtures__/tar-gz.js";

const archive = tarGz([{ name: "seo-v1/CLAW.md", content: "# c" }]);
const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
const fetchArchive = async () => new Response(new Uint8Array(archive));

const args = { repository: "acme/seo", tag: "v1", digest, projectId: "openclaw-abc", convexArgs: ["--prod"] };

describe("parseTemplateAddGitArgs", () => {
  it("reads repository, tag, digest, Project and the arguments forwarded to `convex run`", () => {
    expect(
      parseTemplateAddGitArgs(["acme/seo", "--tag", "v1", "--digest", digest, "--project", "p", "--", "--prod"]),
    ).toEqual({ repository: "acme/seo", tag: "v1", digest, projectId: "p", convexArgs: ["--prod"] });
  });

  it("reads the optional --asset", () => {
    expect(
      parseTemplateAddGitArgs(["a/b", "--tag", "x@1", "--asset", "x-1.tgz", "--digest", digest, "--project", "p"]),
    ).toEqual({ repository: "a/b", tag: "x@1", asset: "x-1.tgz", digest, projectId: "p", convexArgs: [] });
  });

  it("requires every part", () => {
    expect(() => parseTemplateAddGitArgs(["--tag", "v1", "--digest", digest, "--project", "p"])).toThrow(/<repository>/);
    expect(() => parseTemplateAddGitArgs(["a/b", "--digest", digest, "--project", "p"])).toThrow(/--tag/);
    expect(() => parseTemplateAddGitArgs(["a/b", "--tag", "v1", "--project", "p"])).toThrow(/--digest/);
    expect(() => parseTemplateAddGitArgs(["a/b", "--tag", "v1", "--digest", digest])).toThrow(/--project/);
  });
});

describe("installFromGit", () => {
  it("runs the Git install action with the verified files and the Git origin", async () => {
    const run = vi.fn(() => 0);
    expect(await installFromGit(args, { fetch: fetchArchive, run })).toBe(0);
    const npxArgs = run.mock.calls[0]![0] as string[];
    expect(npxArgs.slice(0, 3)).toEqual(["convex", "run", "template_install_local:addFromGit"]);
    expect(JSON.parse(npxArgs[3]!)).toEqual({
      projectId: "openclaw-abc",
      files: [{ path: "CLAW.md", content: "# c" }],
      gitOrigin: { repository: "https://github.com/acme/seo", tag: "v1", archiveDigest: digest },
    });
    expect(npxArgs.slice(4)).toEqual(["--prod"]);
    expect(npxArgs).toEqual(buildConvexRunGitArgs("openclaw-abc", [{ path: "CLAW.md", content: "# c" }], { repository: "https://github.com/acme/seo", tag: "v1", archiveDigest: digest }, ["--prod"]));
  });

  it("downloads the release asset when one is given and records it in the origin", async () => {
    const run = vi.fn(() => 0);
    const urls: string[] = [];
    const fetchAsset = async (url: string) => (urls.push(url), new Response(new Uint8Array(archive)));
    await installFromGit({ ...args, tag: "seo@1", asset: "seo-1.tgz" }, { fetch: fetchAsset, run });
    expect(urls).toEqual(["https://github.com/acme/seo/releases/download/seo@1/seo-1.tgz"]);
    const payload = JSON.parse((run.mock.calls[0]![0] as string[])[3]!);
    expect(payload.gitOrigin).toEqual({ repository: "https://github.com/acme/seo", tag: "seo@1", asset: "seo-1.tgz", archiveDigest: digest });
  });

  it("installs nothing when the digest does not match", async () => {
    const run = vi.fn(() => 0);
    await expect(installFromGit({ ...args, digest: `sha256:${"1".repeat(64)}` }, { fetch: fetchArchive, run })).rejects.toThrow(/mismatch/i);
    expect(run).not.toHaveBeenCalled();
  });
});
