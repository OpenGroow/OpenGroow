import { describe, it, expect } from "vitest";
import { mergeTemplatesWithAgents, type AgentCardState } from "../src/utils/merge-agent-states";
import type { AgentManifest } from "@convex/template_manifest_contract";

const SEO_MANIFEST: AgentManifest = {
  id: "@opengroow/seo",
  name: "SEO Agent",
  description: "SEO optimisation agent",
  category: "marketing",
  mcpServers: [{ name: "seo-site-analysis", transport: "streamable-http", url: "http://localhost:4000/mcp" }],
};

describe("mergeTemplatesWithAgents", () => {
  it("template with no projectAgents record defaults to inactive", () => {
    const result = mergeTemplatesWithAgents([SEO_MANIFEST],[]);

    expect(result).toHaveLength(1);
    const card = result[0] as AgentCardState;
    expect(card.status).toBe("inactive");
    expect(card.templateId).toBe("@opengroow/seo");
    expect(card.manifest.name).toBe("SEO Agent");
  });

  it("template with active record reflects active status and workspaceKey", () => {
    const agents = [
      {
        _id: "agent-1" as never,
        _creationTime: 0,
        instanceId: "inst-1",
        templateId: "@opengroow/seo",
        status: "active" as const,
        workspaceKey: "ws-abc",
        mcpServerKeys: ["seo-site-analysis"],
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = mergeTemplatesWithAgents([SEO_MANIFEST],agents);

    expect(result).toHaveLength(1);
    const card = result[0];
    expect(card.status).toBe("active");
    expect(card.workspaceKey).toBe("ws-abc");
  });

  it("template with error record reflects error status and errorMessage", () => {
    const agents = [
      {
        _id: "agent-2" as never,
        _creationTime: 0,
        instanceId: "inst-1",
        templateId: "@opengroow/seo",
        status: "error" as const,
        errorMessage: "Workspace creation failed",
        mcpServerKeys: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = mergeTemplatesWithAgents([SEO_MANIFEST],agents);

    const card = result[0];
    expect(card.status).toBe("error");
    expect(card.errorMessage).toBe("Workspace creation failed");
  });

  it("template with activating record reflects activating status", () => {
    const agents = [
      {
        _id: "agent-3" as never,
        _creationTime: 0,
        instanceId: "inst-1",
        templateId: "@opengroow/seo",
        status: "activating" as const,
        mcpServerKeys: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = mergeTemplatesWithAgents([SEO_MANIFEST],agents);

    expect(result[0].status).toBe("activating");
  });

  it("multiple templates merge independently", () => {
    const ANALYTICS_MANIFEST: AgentManifest = {
      id: "analytics",
      name: "Analytics Agent",
      description: "Data analytics agent",
      category: "data",
      mcpServers: [],
    };

    const agents = [
      {
        _id: "agent-4" as never,
        _creationTime: 0,
        instanceId: "inst-1",
        templateId: "@opengroow/seo",
        status: "active" as const,
        workspaceKey: "ws-seo",
        mcpServerKeys: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = mergeTemplatesWithAgents([SEO_MANIFEST, ANALYTICS_MANIFEST], agents);

    expect(result).toHaveLength(2);
    const seoCard = result.find((c) => c.templateId === "@opengroow/seo")!;
    const analyticsCard = result.find((c) => c.templateId === "analytics")!;
    expect(seoCard.status).toBe("active");
    expect(analyticsCard.status).toBe("inactive");
  });

  it("carries the projectAgents.skills[] mirror through to the card (issue #224)", () => {
    const skills = [
      { source: "clawhub" as const, spec: "avoid-ai-writing", origin: "template" as const, status: "installed" as const, updatedAt: 100 },
      { source: "clawhub" as const, spec: "my-user-skill", origin: "user" as const, status: "error" as const, updatedAt: 200, errorMessage: "boom" },
    ];
    const agents = [
      {
        _id: "agent-5" as never,
        _creationTime: 0,
        instanceId: "inst-1",
        templateId: "@opengroow/seo",
        status: "active" as const,
        workspaceKey: "ws-seo",
        mcpServerKeys: [],
        skills,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = mergeTemplatesWithAgents([SEO_MANIFEST], agents);

    expect(result[0].skills).toEqual(skills);
  });

  it("defaults skills to undefined when the projectAgents record has none", () => {
    const result = mergeTemplatesWithAgents([SEO_MANIFEST], []);
    expect(result[0].skills).toBeUndefined();
  });
});
