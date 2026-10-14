import { describe, expect, it } from "vitest";
import { exclusiveResourcesOf, validateManifest } from "./index.js";

const BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://localhost/mcp" }],
  missionTypes: [
    { type: "engage", label: "Engage", payload: "{}", agentsMd: "engage.md" },
    { type: "report", label: "Report", payload: "{}", agentsMd: "report.md" },
  ],
};

function reason(manifest: unknown): string {
  const result = validateManifest(manifest);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("manifest exclusiveResources (issue #656)", () => {
  it("accepts a resource naming declared Mission types", () => {
    const result = validateManifest({ ...BASE, exclusiveResources: { "paired-phone": ["engage"] } });
    expect(result.ok).toBe(true);
  });

  it("rejects a Mission type that is not declared", () => {
    expect(reason({ ...BASE, exclusiveResources: { phone: ["nope"] } })).toContain('exclusiveResources["phone"]');
  });

  it("rejects a malformed declaration", () => {
    expect(reason({ ...BASE, exclusiveResources: { phone: "engage" } })).toContain("exclusiveResources");
    expect(reason({ ...BASE, exclusiveResources: { phone: [] } })).toContain("exclusiveResources");
    expect(reason({ ...BASE, exclusiveResources: ["phone"] })).toContain("exclusiveResources");
  });

  it("requires missionTypes to be declared", () => {
    const { missionTypes: _omit, ...noMissionTypes } = BASE;
    expect(reason({ ...noMissionTypes, exclusiveResources: { phone: ["engage"] } })).toContain("missionTypes");
  });
});

describe("exclusiveResourcesOf", () => {
  const manifest = { ...BASE, exclusiveResources: { phone: ["engage"], gpu: ["engage", "report"] } };

  it("lists the resources a Mission type uses", () => {
    expect(exclusiveResourcesOf(manifest, "engage").sort()).toEqual(["gpu", "phone"]);
    expect(exclusiveResourcesOf(manifest, "report")).toEqual(["gpu"]);
  });

  it("is empty for undeclared Mission types and Templates without the field", () => {
    expect(exclusiveResourcesOf(manifest, "other")).toEqual([]);
    expect(exclusiveResourcesOf(BASE, "engage")).toEqual([]);
    expect(exclusiveResourcesOf(undefined, "engage")).toEqual([]);
  });
});
