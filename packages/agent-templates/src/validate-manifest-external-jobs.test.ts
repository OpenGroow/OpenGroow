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
    { type: "some_mission", label: "Some mission", payload: "{}", agentsMd: "some_mission.md" },
    { type: "create_article", label: "Create article", payload: "{}", agentsMd: "create_article.md" },
  ],
};

describe("validateManifest — rejection: pre-ADR-026 legacy externalJob shapes", () => {
  it("rejects a manifest carrying the legacy scalar 'externalJob' field", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJob: {
        server: "test-mcp",
        mcpTool: "get_status",
        statusField: "status",
        terminalStates: { completed: ["done"], failed: ["error"] },
        resultStatus: "success",
        artifactKind: "video",
        onComplete: "terminal",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/externalJob/);
      expect(result.reason).toMatch(/externalJobsByMissionType/);
    }
  });

  it("rejects a manifest carrying the legacy 'externalJobByMissionType' field", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobByMissionType: {
        some_mission: {
          server: "test-mcp",
          mcpTool: "get_status",
          statusField: "status",
          terminalStates: { completed: ["done"], failed: ["error"] },
          resultStatus: "success",
          artifactKind: "video",
          onComplete: "terminal",
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/externalJobByMissionType/);
      expect(result.reason).toMatch(/externalJobsByMissionType/);
    }
  });
});

describe("validateManifest — rejection: malformed externalJobsByMissionType contract", () => {
  it("rejects a contract with invalid artifactKind 'gif' with an actionable reason", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_status",
            statusField: "status",
            terminalStates: { completed: ["done"], failed: ["error"] },
            resultStatus: "success",
            artifactKind: "gif",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("gif");
      expect(result.reason).toMatch(/markdown|metadata|image|video/);
    }
  });

  it("rejects a contract with invalid resultStatus 'pending'", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_status",
            statusField: "status",
            terminalStates: { completed: ["done"], failed: ["error"] },
            resultStatus: "pending",
            artifactKind: "video",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/externalJobsByMissionType|External Job/i);
      expect(result.reason).toMatch(/needs_human_review|success/);
    }
  });

  it("rejects a contract missing terminalStates.completed", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_status",
            statusField: "status",
            terminalStates: { failed: ["error"] },
            resultStatus: "needs_human_review",
            artifactKind: "video",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/externalJobsByMissionType|External Job/i);
    }
  });

  it("accepts a fully valid contract", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_run_status",
            statusField: "status",
            terminalStates: { completed: ["success", "completed"], failed: ["failed", "error"] },
            resultStatus: "needs_human_review",
            artifactKind: "video",
            onComplete: "terminal",
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a contract with optional resultIdField", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        create_article: {
          generate_article: {
            server: "test-mcp",
            mcpTool: "get_article_status",
            statusField: "status",
            resultIdField: "articleId",
            terminalStates: { completed: ["completed"], failed: ["failed", "skipped"] },
            resultStatus: "needs_human_review",
            artifactKind: "markdown",
            onComplete: "terminal",
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a contract with non-string resultIdField", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        create_article: {
          generate_article: {
            server: "test-mcp",
            mcpTool: "get_article_status",
            statusField: "status",
            resultIdField: 42,
            terminalStates: { completed: ["completed"], failed: ["failed"] },
            resultStatus: "needs_human_review",
            artifactKind: "markdown",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a contract missing onComplete", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_run_status",
            statusField: "status",
            terminalStates: { completed: ["completed"], failed: ["failed"] },
            resultStatus: "needs_human_review",
            artifactKind: "video",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/onComplete/);
    }
  });

  it("rejects a contract with an invalid onComplete value", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        some_mission: {
          some_job: {
            server: "test-mcp",
            mcpTool: "get_run_status",
            statusField: "status",
            terminalStates: { completed: ["completed"], failed: ["failed"] },
            resultStatus: "needs_human_review",
            artifactKind: "video",
            onComplete: "keep_going",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a contract declaring onComplete: resume_mission (ADR-026)", () => {
    const result = validateManifest({
      ...VALID_BASE,
      externalJobsByMissionType: {
        create_article: {
          plan_article: {
            server: "test-mcp",
            mcpTool: "plan_article",
            statusField: "status",
            terminalStates: { completed: ["completed", "skipped"], failed: ["failed"] },
            resultStatus: "needs_human_review",
            artifactKind: "markdown",
            onComplete: "resume_mission",
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });
});
