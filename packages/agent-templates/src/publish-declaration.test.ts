import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { readMediaPath } from "./publish-declaration.js";

// Issue #16, ADR-069: a Mission type declares the Publishable kind it produces
// only; destinations are chosen per Mission/Schedule.
const manifestWith = (publish: unknown) => ({
  id: "t",
  name: "T",
  description: "d",
  category: "test",
  mcpServers: [],
  missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "make.md", publish }],
});

// A `publish.resource` is applied when an External Job completes: the Mission
// type must declare one.
const withJob = (publish: unknown) => ({
  ...manifestWith(publish),
  mcpServers: [{ name: "mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  externalJobsByMissionType: {
    make: {
      produce: {
        server: "mcp",
        mcpTool: "get_run_status",
        statusField: "status",
        terminalStates: { completed: ["done"], failed: ["error"] },
        resultStatus: "needs_human_review",
        artifactKind: "video",
        onComplete: "terminal",
      },
    },
  },
});

describe("validateManifest — missionTypes[].publish", () => {
  it("accepts a known kind", () => {
    expect(validateManifest(manifestWith({ kind: "carousel" })).ok).toBe(true);
  });

  it("accepts a Mission type without publish", () => {
    expect(validateManifest(manifestWith(undefined)).ok).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = validateManifest(manifestWith({ kind: "podcast" }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('"podcast"');
  });

  it("rejects targets: destinations are not declared by Templates", () => {
    const result = validateManifest(manifestWith({ kind: "video", targets: ["instagram"] }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('unknown key "targets"');
  });

  it("accepts platforms among the known identifiers", () => {
    expect(validateManifest(manifestWith({ kind: "carousel", platforms: ["instagram", "tiktok"] })).ok).toBe(true);
  });

  it("rejects a misspelled, duplicated or empty platforms list, naming the known ones", () => {
    const typo = validateManifest(manifestWith({ kind: "carousel", platforms: ["instagram", "tiktkok"] })) as { ok: boolean; reason: string };
    expect(typo.ok).toBe(false);
    expect(typo.reason).toContain('"tiktkok" is not a known platform');
    expect(typo.reason).toContain("tiktok");
    expect((validateManifest(manifestWith({ kind: "carousel", platforms: ["tiktok", "tiktok"] })) as { reason: string }).reason).toContain("twice");
    expect((validateManifest(manifestWith({ kind: "carousel", platforms: [] })) as { reason: string }).reason).toContain("non-empty");
    expect(validateManifest(manifestWith({ kind: "carousel", platforms: "tiktok" })).ok).toBe(false);
  });

  it("accepts require with optional fields of the kind", () => {
    expect(validateManifest(manifestWith({ kind: "video", require: ["title", "coverUrl"] })).ok).toBe(true);
  });

  it.each([
    [{ kind: "video", require: ["videoUrl"] }, "videoUrl"],
    [{ kind: "video", require: ["altText"] }, "altText"],
    [{ kind: "image", require: ["coverUrl"] }, "coverUrl"],
    [{ kind: "video", require: ["title", "title"] }, "twice"],
    [{ kind: "video", require: "title" }, "array"],
    [{ kind: "video", require: ["metadata"] }, "metadata"],
  ])("rejects an invalid require %j", (publish, fragment) => {
    const result = validateManifest(manifestWith(publish));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(fragment);
  });

  it("accepts a resource with the defaults, a custom idArg and a map for the media fields of the kind", () => {
    expect(validateManifest(withJob({ kind: "video", resource: { tool: "get_video" } })).ok).toBe(true);
    expect(
      validateManifest(
        withJob({
          kind: "carousel",
          resource: { tool: "get_slides", idArg: "carouselId", map: { slideUrls: "result.slides[*].url" } },
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateManifest(
        withJob({
          kind: "video",
          resource: { tool: "get_video", map: { videoUrl: "result.video.url", coverUrl: "result.cover[0]" } },
        }),
      ).ok,
    ).toBe(true);
  });

  it.each([
    [{ kind: "video", resource: {} }, "tool"],
    [{ kind: "video", resource: { tool: "get video" } }, "tool"],
    [{ kind: "video", resource: { tool: "t", idArg: "" } }, "idArg"],
    [{ kind: "video", resource: { tool: "t", url: "x" } }, 'unknown key "url"'],
    [{ kind: "video", resource: { tool: "t", map: { imageUrl: "a.b" } } }, "imageUrl"],
    [{ kind: "video", resource: { tool: "t", map: { videoUrl: "" } } }, "path"],
    [{ kind: "video", resource: { tool: "t", map: { videoUrl: "a..b" } } }, "path"],
    [{ kind: "video", resource: { tool: "t", map: { videoUrl: "a[*].b" } } }, "[*]"],
    [{ kind: "carousel", resource: { tool: "t", map: { slideUrls: "$.a/b" } } }, "path"],
    [{ kind: "video", resource: { tool: "t", map: ["a"] } }, "object"],
    [{ kind: "video", resource: "get_video" }, "object"],
  ])("rejects an invalid resource %j", (publish, fragment) => {
    const result = validateManifest(withJob(publish));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(fragment);
  });

  it("accepts an article whose resource returns the whole Publishable, any field mapped", () => {
    expect(validateManifest(withJob({ kind: "article", resource: { tool: "get_article" } })).ok).toBe(true);
    expect(
      validateManifest(withJob({ kind: "article", resource: { tool: "get_article", map: { markdownUrl: "article.md", slug: "article.slug" } } })).ok,
    ).toBe(true);
  });

  it("rejects an article without resource: the MCP owns its whole Publishable", () => {
    const result = validateManifest(withJob({ kind: "article" }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("publish.resource is required");
  });

  it("rejects the removed publish.media with a migration message", () => {
    const result = validateManifest(withJob({ kind: "video", media: { videoUrl: "a.b" } }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("publish.resource");
  });

  it("rejects a resource on a Mission type that declares no External Job", () => {
    const result = validateManifest(manifestWith({ kind: "video", resource: { tool: "get_video" } }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("externalJobsByMissionType");
  });
});

describe("readMediaPath", () => {
  const output = { videoUrl: "https://a/v.mp4", result: { slides: [{ url: "https://a/1" }, { url: "https://a/2" }] } };

  it("reads keys, indexes and every item of a list", () => {
    expect(readMediaPath(output, "videoUrl")).toBe("https://a/v.mp4");
    expect(readMediaPath(output, "result.slides[1].url")).toBe("https://a/2");
    expect(readMediaPath(output, "result.slides[*].url")).toEqual(["https://a/1", "https://a/2"]);
  });

  it("returns undefined for anything missing, including a list with a hole", () => {
    expect(readMediaPath(output, "result.nope")).toBeUndefined();
    expect(readMediaPath(output, "videoUrl.x")).toBeUndefined();
    expect(readMediaPath({ s: [{ url: "a" }, {}] }, "s[*].url")).toBeUndefined();
  });
});

// Issue #62, ADR-074: `publish.onPublished` notifies the producing service once
// a Publication is published. Refused at Activation when malformed.
describe("validateManifest — missionTypes[].publish.onPublished", () => {
  const withServer = (onPublished: unknown) => ({
    ...manifestWith({ kind: "image", onPublished }),
    mcpServers: [{ name: "mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  });
  const reasonOf = (onPublished: unknown) =>
    (validateManifest(withServer(onPublished)) as { ok: boolean; reason?: string }).reason;

  it("accepts a POST to a declared server with the publication placeholders", () => {
    const result = validateManifest(
      withServer({
        server: "mcp",
        method: "POST",
        path: "/articles/{id}/published",
        body: { url: "{publication.externalUrl}", sha: "{publication.externalId}" },
        responseIndexingField: "indexing",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a server the Template does not declare", () => {
    expect(reasonOf({ server: "other", method: "POST", path: "/x" })).toContain('onPublished.server "other" is not declared in mcpServers');
  });

  it("refuses a method other than POST", () => {
    expect(reasonOf({ server: "mcp", method: "GET", path: "/x" })).toContain("onPublished.method must be \"POST\"");
  });

  it("refuses a path that is not relative to the server", () => {
    expect(reasonOf({ server: "mcp", method: "POST", path: "https://evil.example.com/x" })).toContain("onPublished.path must start with /");
  });

  it("refuses an unknown placeholder, in the path or the body", () => {
    expect(reasonOf({ server: "mcp", method: "POST", path: "/a/{input.date}" })).toContain('"{input.date}"');
    expect(reasonOf({ server: "mcp", method: "POST", path: "/a", body: { u: "{publication.status}" } })).toContain('"{publication.status}"');
  });

  it("refuses a body that is not a map of strings", () => {
    expect(reasonOf({ server: "mcp", method: "POST", path: "/a", body: { n: 1 } })).toContain("onPublished.body");
  });

  it("refuses an unknown key and a non-string responseIndexingField", () => {
    expect(reasonOf({ server: "mcp", method: "POST", path: "/a", retries: 3 })).toContain('unknown key "retries"');
    expect(reasonOf({ server: "mcp", method: "POST", path: "/a", responseIndexingField: 1 })).toContain("responseIndexingField");
  });
});
