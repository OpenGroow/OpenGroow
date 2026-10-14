import { describe, it, expect } from "vitest";
import { MAX_MISSION_TYPE_DESCRIPTION_LENGTH, validateManifest, type AgentManifest } from "./index.js";
import { repoPackageTemplate, seoFixtureTemplate } from "./__fixtures__/templates.js";

describe("AgentManifest type contract — manifest & mission types", () => {
  it("SEO fixture manifest has required fields", () => {
    const seo = seoFixtureTemplate();
    expect(seo).toBeDefined();

    const manifest: AgentManifest = seo!.manifest;
    expect(manifest.id).toBe("@acme/seo");
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.description).toBe("string");
    expect(typeof manifest.category).toBe("string");
    expect(Array.isArray(manifest.mcpServers)).toBe(true);
    expect(manifest.mcpServers.length).toBeGreaterThan(0);
  });

  it("SEO fixture manifest declares explicit review content contracts per Mission type", () => {
    const seo = seoFixtureTemplate();
    const review = seo.manifest.missionTypes?.find((m) => m.type === "create_article")?.review;
    expect(review).toBeDefined();
    expect(review.kind).toBe("markdown");
    expect(review.server).toBe("article-mcp");
    expect(review.path).toContain("{id}");
  });

  it("seo review.server references an existing entry in mcpServers", () => {
    const seo = seoFixtureTemplate();
    const review = seo.manifest.missionTypes?.find((m) => m.type === "create_article")?.review!;
    const serverNames = seo.manifest.mcpServers.map((s) => s.name);
    expect(serverNames).toContain(review.server);
  });

  it("SEO fixture manifest declares missionTypes with create_article and internal_linking", () => {
    const seo = seoFixtureTemplate();
    expect(seo.manifest.missionTypes).toBeDefined();
    const types = seo.manifest.missionTypes!.map((m) => m.type);
    expect(types).toContain("create_article");
    expect(types).toContain("internal_linking");

    const createArticle = seo.manifest.missionTypes!.find((m) => m.type === "create_article")!;
    expect(createArticle.label).toBe("Create article");
    // Default keyword is empty — the agent falls back to the highest-priority
    // keyword from list_keywords when the payload doesn't hint at one (AGENTS.md).
    const seoPayload = JSON.parse(createArticle.payload) as Record<string, unknown>;
    expect(typeof seoPayload.keyword).toBe("string");
    expect(seoPayload.keyword).toBe("");
  });

  it("validateManifest accepts a valid missionTypes array", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [
        {
          type: "create_thing",
          label: "Create thing",
          payload: '{"key":""}',
          agentsMd: "create thing.md",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  describe("Mission type description bound (Source routing input)", () => {
    const withDescription = (description: string) =>
      validateManifest({
        id: "test",
        name: "Test",
        description: "Test manifest",
        category: "demo",
        mcpServers: [],
        missionTypes: [
          { type: "create_thing", label: "Create thing", description, payload: "{}", agentsMd: "create_thing.md" },
        ],
      });

    it("accepts a description of exactly the maximum length", () => {
      expect(withDescription("x".repeat(MAX_MISSION_TYPE_DESCRIPTION_LENGTH)).ok).toBe(true);
    });

    it("refuses a description over the maximum length", () => {
      expect(withDescription("x".repeat(MAX_MISSION_TYPE_DESCRIPTION_LENGTH + 1))).toEqual({
        ok: false,
        reason: expect.stringContaining(`${MAX_MISSION_TYPE_DESCRIPTION_LENGTH}`),
      });
    });

    it("is respected by the fixture Templates", () => {
      for (const template of [seoFixtureTemplate(), repoPackageTemplate("hello"), repoPackageTemplate("source"), repoPackageTemplate("engagement")]) {
        for (const missionType of template.manifest.missionTypes ?? []) {
          expect([...(missionType.description ?? "")].length).toBeLessThanOrEqual(MAX_MISSION_TYPE_DESCRIPTION_LENGTH);
        }
      }
    });

    it("refuses an over-limit Template description when a Mission type falls back to it for routing", () => {
      const result = validateManifest({
        id: "test",
        name: "Test",
        description: "x".repeat(MAX_MISSION_TYPE_DESCRIPTION_LENGTH + 1),
        category: "demo",
        mcpServers: [],
        missionTypes: [{ type: "create_thing", label: "Create thing", payload: "{}", agentsMd: "create_thing.md" }],
      });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`${MAX_MISSION_TYPE_DESCRIPTION_LENGTH}`) });
    });

    it("allows a long Template description when every Mission type has its own description", () => {
      const result = validateManifest({
        id: "test",
        name: "Test",
        description: "x".repeat(MAX_MISSION_TYPE_DESCRIPTION_LENGTH + 1),
        category: "demo",
        mcpServers: [],
        missionTypes: [
          { type: "create_thing", label: "Create thing", description: "Makes things", payload: "{}", agentsMd: "create_thing.md" },
        ],
      });
      expect(result.ok).toBe(true);
    });
  });

  it("validateManifest accepts a manifest without missionTypes (optional field)", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
    });
    expect(result.ok).toBe(true);
  });

  it("validateManifest requires instructions for every declared Mission type", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [
        {
          type: "create_thing",
          label: "Create thing",
          payload: "{}",
          agentsMd: "create_thing.md",
        },
        {
          type: "update_thing",
          label: "Update thing",
          payload: "{}",
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("agentsMd"),
    });
  });

  it("validateManifest requires a dedicated instruction path for each Mission type", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [
        { type: "create_thing", label: "Create thing", payload: "{}", agentsMd: "shared.md" },
        { type: "update_thing", label: "Update thing", payload: "{}", agentsMd: "shared.md" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("unique agentsMd"),
    });
  });

  it("validateManifest requires a unique type for each Mission type", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [
        { type: "create_thing", label: "Create thing", payload: "{}", agentsMd: "create.md" },
        { type: "create_thing", label: "Create another thing", payload: "{}", agentsMd: "create_another.md" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("unique type"),
    });
  });

  it("validateManifest rejects missionTypes entry missing type", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [{ label: "Create thing", payload: '{}' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("missionTypes");
    }
  });

  it("validateManifest rejects missionTypes entry with empty type string", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [{ type: "", label: "Create thing", payload: '{}' }],
    });
    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects missionTypes entry missing label", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [{ type: "create_thing", payload: '{}' }],
    });
    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects missionTypes entry with non-string payload", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [{ type: "create_thing", label: "Create thing", payload: {} }],
    });
    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects a non-string per-mission instruction path", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [
        {
          type: "create_thing",
          label: "Create thing",
          payload: "{}",
          agentsMd: 42,
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it.each(["../secret.md", "/tmp/secret.md", "nested\\secret.md", "instructions.txt"])(
    "validateManifest rejects unsafe per-mission instruction path %s",
    (agentsMd) => {
      const result = validateManifest({
        id: "test",
        name: "Test",
        description: "Test manifest",
        category: "demo",
        mcpServers: [],
        missionTypes: [
          {
            type: "create_thing",
            label: "Create thing",
            payload: "{}",
            agentsMd,
          },
        ],
      });

      expect(result.ok).toBe(false);
    },
  );

  it.each([
    "TOOLS.md",
    "nested/tools.md",
    "AGENTS.md",
    ".git/instructions.md",
    "memory/instructions.md",
    "missions/instructions.md",
    "node_modules/instructions.md",
    "skills/instructions.md",
    " create_thing.md",
  ])("validateManifest rejects reserved per-mission instruction path %s", (agentsMd) => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: [{ type: "create_thing", label: "Create thing", payload: "{}", agentsMd }],
    });

    expect(result.ok).toBe(false);
  });

  it("validateManifest rejects missionTypes that is not an array", () => {
    const result = validateManifest({
      id: "test",
      name: "Test",
      description: "Test manifest",
      category: "demo",
      mcpServers: [],
      missionTypes: { type: "create_thing", label: "Create thing", payload: '{}' },
    });
    expect(result.ok).toBe(false);
  });
});
