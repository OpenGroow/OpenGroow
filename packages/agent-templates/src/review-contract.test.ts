import { describe, it, expect } from "vitest";
import { templateSupportsAutoPublish } from "./review-contract.js";
import type { AgentManifest, ReviewContentContract } from "./types";

const SEO_MCP_SERVER = { name: "article-mcp", transport: "streamable-http", url: "http://localhost/mcp" };

const FULL_FLOW_REVIEW = {
  kind: "markdown" as const,
  server: "article-mcp",
  path: "/articles/{id}",
  actions: [
    {
      key: "approve" as const,
      label: "Approve",
      requiredStatus: "to_validate" as const,
      transition: "approved" as const,
    },
    {
      key: "publish" as const,
      label: "Publish",
      requiredStatus: "approved" as const,
      transition: "done" as const,
    },
  ],
};

function manifestWithReview(review?: ReviewContentContract): AgentManifest {
  return {
    id: "test",
    name: "Test",
    description: "Test",
    category: "demo",
    mcpServers: [SEO_MCP_SERVER],
    missionTypes: [
      {
        type: "any_type",
        label: "Any type",
        payload: "{}",
        ...(review !== undefined ? { review } : {}),
      },
    ],
  };
}

describe("templateSupportsAutoPublish", () => {
  it("returns true when the resolved review contract has both a to_validate and an approved action", () => {
    const manifest = manifestWithReview(FULL_FLOW_REVIEW);
    expect(templateSupportsAutoPublish(manifest, "any_type")).toBe(true);
  });

  it("returns false when the manifest has no review contract at all", () => {
    const manifest = manifestWithReview();
    expect(templateSupportsAutoPublish(manifest, "any_type")).toBe(false);
  });

  it("returns false when the review contract has no actions", () => {
    const manifest = manifestWithReview({ kind: "markdown", server: "article-mcp", path: "/articles/{id}" });
    expect(templateSupportsAutoPublish(manifest, "any_type")).toBe(false);
  });

  it("returns false when only a to_validate action is declared (no approved action)", () => {
    const manifest = manifestWithReview({
      kind: "markdown",
      server: "article-mcp",
      path: "/articles/{id}",
      actions: [
        {
          key: "approve",
          label: "Approve",
          requiredStatus: "to_validate",
          transition: "approved",
        },
      ],
    });
    expect(templateSupportsAutoPublish(manifest, "any_type")).toBe(false);
  });

  it("checks the review contract on the given Mission type", () => {
    const manifest: AgentManifest = {
      ...manifestWithReview(),
      missionTypes: [
        { type: "internal_linking", label: "Internal linking", payload: "{}", review: FULL_FLOW_REVIEW },
      ],
    };
    expect(templateSupportsAutoPublish(manifest, "internal_linking")).toBe(true);
    expect(templateSupportsAutoPublish(manifest, "other_type")).toBe(false);
  });
});
