import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";
import { seoFixtureTemplate } from "./__fixtures__/templates.js";

const VALID_BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  missionTypes: [{ type: "test_mission", label: "Test mission", payload: "{}", agentsMd: "test_mission.md" }],
};

const review = (contract: Record<string, unknown>) => ({
  ...VALID_BASE,
  missionTypes: [{ type: "test_mission", label: "Test mission", payload: "{}", agentsMd: "test_mission.md", review: contract }],
});

describe("validateManifest — typed Mission contracts", () => {
  it("accepts the SEO fixture manifest", () => {
    expect(validateManifest(seoFixtureTemplate().manifest).ok).toBe(true);
  });

  it("rejects the removed Template-wide review field", () => {
    const result = validateManifest({
      ...VALID_BASE,
      review: { kind: "markdown", server: "test-mcp", path: "/content/{id}" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missionTypes|no longer valid/);
  });

  it("rejects an invalid review content kind", () => {
    const result = validateManifest(review({ kind: "html", server: "test-mcp", path: "/content/{id}" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("html");
  });

  it("accepts valid video and metadata review kinds", () => {
    expect(validateManifest(review({ kind: "video", server: "test-mcp", path: "/videos/{id}" })).ok).toBe(true);
    expect(validateManifest(review({ kind: "metadata", server: "test-mcp", path: "/items/{id}" })).ok).toBe(true);
  });

  it("accepts an optional cover path on an external review contract", () => {
    expect(validateManifest(review({
      kind: "markdown",
      server: "test-mcp",
      path: "/articles/{id}",
      coverPath: "/images/{id}/cover",
    })).ok).toBe(true);
  });

  it("rejects an undeclared review server", () => {
    const result = validateManifest(review({ kind: "markdown", server: "ghost-server", path: "/articles/{id}" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ghost-server");
  });

  it("rejects an undeclared BoundedHttpEffect server", () => {
    const result = validateManifest(review({
      kind: "markdown",
      server: "test-mcp",
      path: "/articles/{id}",
      actions: [{
        key: "approve",
        label: "Approve",
        requiredStatus: "to_validate",
        effect: { server: "unknown-server", method: "POST", path: "/articles/{id}/approve" },
        transition: "approved",
      }],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unknown-server");
  });

  it("accepts a revision_run effect without a server", () => {
    expect(validateManifest(review({
      kind: "video",
      server: "test-mcp",
      path: "/videos/{id}",
      actions: [{
        key: "reject",
        label: "Reject with feedback",
        requiredStatus: "to_validate",
        effect: { kind: "revision_run", feedbackKey: "feedback" },
        transition: "doing",
      }],
    })).ok).toBe(true);
  });

  it("rejects an invalid action key and malformed effects", () => {
    const invalidKey = validateManifest(review({
      kind: "markdown", server: "test-mcp", path: "/articles/{id}",
      actions: [{ key: "delete", label: "Delete", requiredStatus: "to_validate", transition: "done" }],
    }));
    expect(invalidKey.ok).toBe(false);

    const invalidEffect = validateManifest(review({
      kind: "markdown", server: "test-mcp", path: "/articles/{id}",
      actions: [{
        key: "approve", label: "Approve", requiredStatus: "to_validate",
        effect: { kind: "arbitrary_code", fn: "doSomething" }, transition: "approved",
      }],
    }));
    expect(invalidEffect.ok).toBe(false);
  });

  it("requires missionTypes for typed contracts and validates blocker declarations", () => {
    const missingMissionTypes = validateManifest({
      ...VALID_BASE,
      missionTypes: undefined,
      blockers: [{ code: "needs_human", label: "Needs human", resolutionKind: "execution_device" }],
    });
    expect(missingMissionTypes.ok).toBe(false);

    const invalidBlocker = validateManifest({
      ...VALID_BASE,
      blockers: [{ code: "needs_human", label: "Needs human", resolutionKind: "modal" }],
    });
    expect(invalidBlocker.ok).toBe(false);
  });

  it("rejects an external job for an unknown Mission type", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        other_mission: {
          some_job: {
            server: "test-mcp", mcpTool: "get_status", statusField: "status",
            terminalStates: { completed: ["success"], failed: ["failed"] },
            resultStatus: "success", artifactKind: "video", onComplete: "terminal",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("other_mission");
  });
});
