import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

/** Minimal valid manifest with one declared MCP server, used as a base for rejection tests. */
const VALID_BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  missionTypes: [
    { type: "create_article", label: "Create article", payload: "{}", agentsMd: "create_article.md" },
  ],
};

describe("validateManifest — rejection: malformed generativeMcpCall", () => {
  it("rejects a generativeMcpCall entry for an unknown mission type", () => {
    const result = validateManifest({
      ...VALID_BASE,
      generativeMcpCall: {
        unknown_mission: { toolName: "generate_article" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/generativeMcpCall/);
      expect(result.reason).toContain("unknown_mission");
    }
  });

  it("rejects a generativeMcpCall entry missing toolName", () => {
    const result = validateManifest({
      ...VALID_BASE,
      generativeMcpCall: {
        create_article: {},
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/generativeMcpCall/);
      expect(result.reason).toMatch(/toolName/);
    }
  });
});

describe("validateManifest — rejection: generativeMcpCall drifted from externalJobsByMissionType", () => {
  it("rejects a toolName not declared as a job type in externalJobsByMissionType for the same mission type", () => {
    const result = validateManifest({
      ...VALID_BASE,
      generativeMcpCall: {
        create_article: { toolName: "renamed_generate_article" },
      },
      externalJobsByMissionType: {
        create_article: {
          generate_article: {
            server: "test-mcp",
            mcpTool: "get_article_status",
            statusField: "status",
            terminalStates: { completed: ["completed"], failed: ["failed"] },
            resultStatus: "needs_human_review",
            artifactKind: "markdown",
            onComplete: "terminal",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/generativeMcpCall/);
      expect(result.reason).toContain("renamed_generate_article");
    }
  });

  it("skips the cross-check when the mission type declares no externalJobsByMissionType at all", () => {
    const result = validateManifest({
      ...VALID_BASE,
      generativeMcpCall: {
        create_article: { toolName: "some_synchronous_tool" },
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateManifest — accepts a valid generativeMcpCall", () => {
  it("accepts a generativeMcpCall entry for a known mission type", () => {
    const result = validateManifest({
      ...VALID_BASE,
      generativeMcpCall: {
        create_article: { toolName: "generate_article" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.generativeMcpCall).toEqual({
        create_article: { toolName: "generate_article" },
      });
    }
  });
});
