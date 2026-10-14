import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

describe("Template-declared Agent Skills (issue #222)", () => {
  const baseManifest = {
    id: "demo",
    name: "Demo",
    description: "",
    category: "demo",
    mcpServers: [],
  };

  it("validateManifest accepts a well-formed skills declaration", () => {
    const result = validateManifest({
      ...baseManifest,
      skills: [{ source: "clawhub", spec: "avoid-ai-writing" }],
    });
    expect(result.ok).toBe(true);
  });

  it("validateManifest rejects a skill source other than clawhub", () => {
    const result = validateManifest({
      ...baseManifest,
      skills: [{ source: "npm", spec: "avoid-ai-writing" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("skills");
  });

  it("validateManifest rejects a blank spec (after trim)", () => {
    const result = validateManifest({
      ...baseManifest,
      skills: [{ source: "clawhub", spec: "   " }],
    });
    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects a malformed skills entry (missing spec)", () => {
    const result = validateManifest({
      ...baseManifest,
      skills: [{ source: "clawhub" }],
    });
    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects skills that is not an array", () => {
    const result = validateManifest({
      ...baseManifest,
      skills: { source: "clawhub", spec: "avoid-ai-writing" },
    });
    expect(result.ok).toBe(false);
  });

  it("a manifest with no skills declared is still valid (skills is optional)", () => {
    const result = validateManifest(baseManifest);
    expect(result.ok).toBe(true);
  });
});
