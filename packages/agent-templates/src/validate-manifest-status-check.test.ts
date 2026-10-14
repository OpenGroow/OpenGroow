import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { seoFixtureTemplate } from "./__fixtures__/templates.js";

const VALID_BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  requirements: [{ key: "apiKey", type: "password", label: "API key", required: true, immutable: true }],
};

describe("validateManifest — statusCheck contract (issue #320, ADR-034)", () => {
  it("accepts a Template with only apiKey in requirements and a statusCheck declaration instead of activation/reconfiguration", () => {
    const result = validateManifest({
      ...VALID_BASE,
      statusCheck: { server: "test-mcp", mcpTool: "get_project_status" },
    });
    expect(result.ok).toBe(true);
  });

  it("does not require activation or reconfiguration to be present", () => {
    const result = validateManifest(VALID_BASE);
    expect(result.ok).toBe(true);
  });

  it("rejects a statusCheck missing mcpTool", () => {
    const result = validateManifest({
      ...VALID_BASE,
      statusCheck: { server: "test-mcp" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/statusCheck/);
      expect(result.reason).toMatch(/mcpTool/);
    }
  });

  it("rejects a statusCheck missing server", () => {
    const result = validateManifest({
      ...VALID_BASE,
      statusCheck: { mcpTool: "get_project_status" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/statusCheck/);
    }
  });

  it("rejects a statusCheck referencing an undeclared server", () => {
    const result = validateManifest({
      ...VALID_BASE,
      statusCheck: { server: "ghost-mcp", mcpTool: "get_project_status" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ghost-mcp");
      expect(result.reason).toMatch(/mcpServers/);
    }
  });

  it("accepts the SEO fixture manifest as valid with a statusCheck contract (regression)", () => {
    const seo = seoFixtureTemplate();
    const result = validateManifest(seo.manifest);
    expect(result.ok).toBe(true);
    expect(seo.manifest.statusCheck).toBeDefined();
    expect(seo.manifest.activation).toBeUndefined();
    expect(seo.manifest.reconfiguration).toBeUndefined();
  });
});
