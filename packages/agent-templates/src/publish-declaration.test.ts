import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

// Issue #16, ADR-069: a Mission type declares the Publishable kind it produces
// and the Publish targets it may use.
const manifestWith = (publish: unknown) => ({
  id: "t",
  name: "T",
  description: "d",
  category: "test",
  mcpServers: [],
  missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "make.md", publish }],
});

describe("validateManifest — missionTypes[].publish", () => {
  it("accepts a known kind with well-formed targets", () => {
    const result = validateManifest(manifestWith({ kind: "carousel", targets: ["instagram", "pinterest:recipes"] }));
    expect(result.ok).toBe(true);
  });

  it("accepts a Mission type without publish", () => {
    expect(validateManifest(manifestWith(undefined)).ok).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = validateManifest(manifestWith({ kind: "article", targets: ["instagram"] }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('"article"');
  });

  it.each([
    ["no targets", { kind: "video" }],
    ["empty targets", { kind: "video", targets: [] }],
    ["non-string target", { kind: "video", targets: [3] }],
    ["blank target", { kind: "video", targets: [" "] }],
    ["target with spaces", { kind: "video", targets: ["my channel"] }],
    ["duplicate targets", { kind: "video", targets: ["x", "x"] }],
  ])("rejects malformed targets: %s", (_name, publish) => {
    const result = validateManifest(manifestWith(publish));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("publish");
  });

  it("rejects an unknown key inside publish", () => {
    expect(validateManifest(manifestWith({ kind: "video", targets: ["x"], channelId: "1" })).ok).toBe(false);
  });
});
