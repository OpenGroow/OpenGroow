import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

const VALID_BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
};

describe("validateManifest — activation/reconfiguration contract (ADR-021)", () => {
  const ACTIVATION_BASE = {
    ...VALID_BASE,
    requirements: [
      { key: "domain", type: "text", label: "Domain", required: true },
      { key: "apiKey", type: "password", label: "API key", required: true },
    ],
  };

  it("accepts a valid activation with {responseId} in body", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { projectId: "{responseId}", domain: "{domain}" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid reconfiguration with {config.*} in path", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      reconfiguration: {
        server: "test-mcp",
        method: "PATCH",
        path: "/projects/{config.projectId}",
        responseIdField: "projectId",
        body: { domain: "{domain}" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects activation with body ref pointing to an undeclared requirement key", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { projectId: "{responseId}", undeclaredKey: "{notDeclared}" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("notDeclared");
      expect(result.reason).toMatch(/requirements|responseId|config/);
    }
  });

  it("accepts {config.*} refs in body", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { projectId: "{responseId}", frozen: "{config.frozenKey}" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects path with non-config interpolation reference", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects/{domain}",
        responseIdField: "projectId",
        body: { projectId: "{responseId}" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/path.*config\.|config\.*path/i);
    }
  });

  it("rejects activation missing responseIdField", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        body: { projectId: "{responseId}" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("responseIdField");
    }
  });

  it("rejects activation with undeclared server", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "ghost-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { projectId: "{responseId}" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ghost-mcp");
      expect(result.reason).toMatch(/mcpServers/);
    }
  });

  it("rejects POST activation whose body has no {responseId} leaf (no derivable id key)", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { domain: "{domain}" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("responseId");
    }
  });

  it("allows PATCH reconfiguration without a {responseId} leaf (id already frozen)", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      reconfiguration: {
        server: "test-mcp",
        method: "PATCH",
        path: "/projects/{config.projectId}",
        responseIdField: "projectId",
        body: { domain: "{domain}" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an activation body containing a JSON array (ADR-021 bodies are literals + {ref} trees)", () => {
    const result = validateManifest({
      ...ACTIVATION_BASE,
      activation: {
        server: "test-mcp",
        method: "POST",
        path: "/projects",
        responseIdField: "projectId",
        body: { projectId: "{responseId}", tags: ["{domain}"] },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/array/i);
    }
  });

  // SEO/video no longer declare activation/reconfiguration effects (issue #320,
  // ADR-034) — they gate Activation on a statusCheck contract instead. See
  // validate-manifest-status-check.test.ts for their regression coverage.
});
