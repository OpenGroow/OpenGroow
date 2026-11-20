import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { INTERNAL_MCP_TOOL_NAMES } from "./internal-mcp.js";

const base = (mcpServers: unknown[]) => ({
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers,
});

const internal = (extra: Record<string, unknown> = {}) => ({
  name: "opengroow",
  transport: "streamable-http",
  internal: { tools: ["list_mission_types"] },
  ...extra,
});

describe("validateManifest: Internal MCP declaration (ADR-080)", () => {
  it("accepts an Internal MCP server with a tool list and no URL", () => {
    const result = validateManifest(base([internal()]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.mcpServers[0]).toMatchObject({ name: "opengroow", internal: { tools: ["list_mission_types"] } });
      // The Template never holds the URL: OpenGroow derives it from the deployment.
      expect(result.manifest.mcpServers[0].url).toBe("");
    }
  });

  it("refuses a URL on the Internal MCP server", () => {
    const result = validateManifest(base([internal({ url: "https://example.com/mcp" })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/internal/i);
  });

  it("refuses an empty tool list", () => {
    expect(validateManifest(base([internal({ internal: { tools: [] } })])).ok).toBe(false);
  });

  it("refuses a tool the catalog does not have", () => {
    const result = validateManifest(base([internal({ internal: { tools: ["drop_everything"] } })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/drop_everything/);
  });

  it("refuses a duplicated tool", () => {
    const result = validateManifest(base([internal({ internal: { tools: ["list_mission_types", "list_mission_types"] } })]));
    expect(result.ok).toBe(false);
  });

  it("refuses another transport than streamable-http", () => {
    expect(validateManifest(base([internal({ transport: "sse" })])).ok).toBe(false);
  });

  it("refuses a second server next to the Internal MCP (the token header is applied to every server)", () => {
    const result = validateManifest(base([internal(), { name: "other", transport: "streamable-http", url: "https://example.com/mcp" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no other server/i);
  });

  it("refuses headers on the Internal MCP server", () => {
    expect(validateManifest(base([internal({ headers: { Authorization: "Bearer x" } })])).ok).toBe(false);
  });

  it("exposes the catalog's tool names", () => {
    expect(INTERNAL_MCP_TOOL_NAMES).toContain("list_mission_types");
  });
});
