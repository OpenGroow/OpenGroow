import { describe, expect, it } from "vitest";
import {
  resolveBlocker,
  resolveReviewContract,
  validateManifest,
  type AgentManifest,
} from "./index.js";

const SEO_MCP_SERVER = {
  name: "article-mcp",
  transport: "streamable-http",
  url: "http://localhost/mcp",
};

const manifest: AgentManifest = {
  id: "test",
  name: "Test",
  description: "Test",
  category: "demo",
  mcpServers: [SEO_MCP_SERVER],
  missionTypes: [
    {
      type: "engage",
      label: "Engage",
      payload: "{}",
      agentsMd: "engage.md",
      review: { kind: "markdown", server: "article-mcp", path: "/items/{id}" },
      blockers: [
        {
          code: "account_unavailable",
          label: "Account unavailable",
          resolutionKind: "execution_device",
        },
      ],
    },
  ],
};

describe("Mission type contracts", () => {
  it("resolves review and blockers directly from the Mission type", () => {
    expect(resolveReviewContract(manifest, "engage")?.path).toBe("/items/{id}");
    expect(resolveBlocker(manifest, "engage", "account_unavailable")).toMatchObject({
      code: "account_unavailable",
      resolutionKind: "execution_device",
    });
  });

  it("validates contracts nested in missionTypes", () => {
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it("rejects a legacy top-level review map and blockers list", () => {
    const result = validateManifest({
      ...manifest,
      missionTypes: [{ type: "engage", label: "Engage", payload: "{}", agentsMd: "engage.md" }],
      reviewByMissionType: {
        engage: { kind: "markdown", server: "article-mcp", path: "/items/{id}" },
      },
      blockers: [
        { code: "account_unavailable", label: "Account unavailable", resolutionKind: "execution_device" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reviewByMissionType|blockers|mission type/i);
  });
});
