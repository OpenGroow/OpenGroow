import { describe, it, expect } from "vitest";
import { resolveReviewContract, validateManifest, type AgentManifest } from "./index.js";
import { seoFixtureTemplate } from "./__fixtures__/templates.js";

const SEO_MCP_SERVER = { name: "article-mcp", transport: "streamable-http", url: "http://localhost/mcp" };

const DEFAULT_REVIEW = {
  kind: "markdown" as const,
  server: "article-mcp",
  path: "/articles/{id}",
};

const LINKING_REVIEW = {
  kind: "markdown" as const,
  server: "article-mcp",
  path: "/linking-jobs/{id}",
};

const missionTypesWithReviews = [
  { type: "create_article", label: "Create article", payload: "{}", agentsMd: "create_article.md", review: DEFAULT_REVIEW },
  { type: "internal_linking", label: "Internal linking", payload: "{}", agentsMd: "internal_linking.md", review: LINKING_REVIEW },
];

describe("resolveReviewContract", () => {
  it("returns the review contract from the matching Mission type", () => {
    const manifest: AgentManifest = {
      id: "test",
      name: "Test",
      description: "Test",
      category: "demo",
      mcpServers: [SEO_MCP_SERVER],
      missionTypes: missionTypesWithReviews,
    };

    const result = resolveReviewContract(manifest, "internal_linking");
    expect(result).toBe(LINKING_REVIEW);
  });

  it("returns undefined when the Mission type is not declared", () => {
    const manifest: AgentManifest = {
      id: "test",
      name: "Test",
      description: "Test",
      category: "demo",
      mcpServers: [SEO_MCP_SERVER],
      missionTypes: missionTypesWithReviews,
    };

    const result = resolveReviewContract(manifest, "other_type");
    expect(result).toBeUndefined();
  });

  it("returns undefined when Mission types are absent", () => {
    const manifest: AgentManifest = {
      id: "test",
      name: "Test",
      description: "Test",
      category: "demo",
      mcpServers: [SEO_MCP_SERVER],
    };

    const result = resolveReviewContract(manifest, "internal_linking");
    expect(result).toBeUndefined();
  });

  it("returns the internal_linking review contract from the SEO fixture manifest", () => {
    const seo = seoFixtureTemplate();
    const contract = resolveReviewContract(seo.manifest, "internal_linking");
    expect(contract).toBeDefined();
    expect(contract!.path).toContain("/linking-jobs/");
    expect(contract!.path).toContain("{id}");
    expect(contract!.server).toBe("article-mcp");
  });

  it("returns the articles review contract from the SEO fixture manifest for create_article", () => {
    const seo = seoFixtureTemplate();
    const contract = resolveReviewContract(seo.manifest, "create_article");
    expect(contract).toBeDefined();
    expect(contract!.path).toContain("/articles/");
  });
});

describe("validateManifest — Mission type review contracts", () => {
  const VALID_BASE_WITH_SERVER = {
    id: "test",
    name: "Test",
    description: "Test",
    category: "demo",
    mcpServers: [{ name: "article-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
  };

  const withReview = (review: unknown) => ({
    ...VALID_BASE_WITH_SERVER,
    missionTypes: [{ type: "internal_linking", label: "Internal linking", payload: "{}", agentsMd: "internal_linking.md", review }],
  });

  it("accepts a manifest with a valid review contract inside a Mission type", () => {
    const result = validateManifest(
      withReview({ kind: "markdown", server: "article-mcp", path: "/linking-jobs/{id}" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a Mission type review contract with an invalid kind", () => {
    const result = validateManifest(
      withReview({ kind: "html", server: "article-mcp", path: "/linking-jobs/{id}" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("internal_linking");
  });

  it("rejects a Mission type review contract with an undeclared server", () => {
    const result = validateManifest(
      withReview({ kind: "markdown", server: "ghost-mcp", path: "/linking-jobs/{id}" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ghost-mcp");
  });

  it("rejects a Mission type review contract that is not an object", () => {
    const result = validateManifest(withReview("not-an-object"));
    expect(result.ok).toBe(false);
  });

  it("rejects a review action whose effect server is undeclared", () => {
    const result = validateManifest(
      withReview({
        kind: "markdown",
        server: "article-mcp",
        path: "/linking-jobs/{id}",
        actions: [
          {
            key: "publish",
            label: "Merge",
            requiredStatus: "approved",
            effect: { server: "phantom-mcp", method: "POST", path: "/linking-jobs/{id}/merge" },
            transition: "done",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("phantom-mcp");
  });

  it("SEO fixture manifest passes validation with Mission type review contracts", () => {
    const seo = seoFixtureTemplate();
    const result = validateManifest(seo.manifest);
    expect(result.ok).toBe(true);
  });

  it("SEO fixture manifest declares internal_linking review on that Mission type", () => {
    const seo = seoFixtureTemplate();
    const internalLinking = seo.manifest.missionTypes?.find((entry) => entry.type === "internal_linking");
    expect(internalLinking?.review).toBeDefined();
    expect(internalLinking?.review?.path).toContain("{id}");
    expect(internalLinking?.review?.server).toBe("article-mcp");
  });

  it("seo internal_linking review declares Validate (approve) and Merge (publish) actions", () => {
    const seo = seoFixtureTemplate();
    const contract = seo.manifest.missionTypes?.find((entry) => entry.type === "internal_linking")?.review;
    const actions = contract?.actions ?? [];
    const approve = actions.find((a) => a.key === "approve");
    const publish = actions.find((a) => a.key === "publish");
    expect(approve).toBeDefined();
    expect(approve!.label).toBe("Validate");
    expect(approve!.requiredStatus).toBe("to_validate");
    expect(approve!.transition).toBe("approved");
    expect(publish).toBeDefined();
    expect(publish!.label).toBe("Merge");
    expect(publish!.requiredStatus).toBe("approved");
    expect(publish!.transition).toBe("done");
  });

  it("seo internal_linking approve action has no effect (pure state transition)", () => {
    const seo = seoFixtureTemplate();
    const approve = seo.manifest.missionTypes
      ?.find((entry) => entry.type === "internal_linking")
      ?.review?.actions?.find((a) => a.key === "approve");
    expect(approve!.effect).toBeUndefined();
  });

  it("seo internal_linking publish action calls POST /linking-jobs/{id}/merge", () => {
    const seo = seoFixtureTemplate();
    const publish = seo.manifest.missionTypes
      ?.find((entry) => entry.type === "internal_linking")
      ?.review?.actions?.find((a) => a.key === "publish");
    const effect = publish!.effect;
    expect(effect && "method" in effect ? effect.method : undefined).toBe("POST");
    expect(effect && "path" in effect ? effect.path : undefined).toContain("/linking-jobs/");
    expect(effect && "path" in effect ? effect.path : undefined).toContain("/merge");
  });
});
