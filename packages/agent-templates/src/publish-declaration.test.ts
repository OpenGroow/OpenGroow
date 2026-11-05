import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

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

describe("validateManifest — missionTypes[].publish", () => {
  it("accepts a known kind", () => {
    expect(validateManifest(manifestWith({ kind: "carousel" })).ok).toBe(true);
  });

  it("accepts a Mission type without publish", () => {
    expect(validateManifest(manifestWith(undefined)).ok).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = validateManifest(manifestWith({ kind: "article" }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('"article"');
  });

  it("rejects targets: destinations are not declared by Templates", () => {
    const result = validateManifest(manifestWith({ kind: "video", targets: ["instagram"] }));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('unknown key "targets"');
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
});
