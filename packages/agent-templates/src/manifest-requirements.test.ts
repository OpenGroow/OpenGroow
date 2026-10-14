import { describe, it, expect } from "vitest";
import { deliveredRequirementField, flattenRequirementFields, validateManifest } from "./index.js";

describe("AgentManifest type contract — requirements", () => {
  it("manifest validator accepts an explicit Mission-type review block", () => {
    const manifest = (reviewKind: string) => ({
      id: "with-review",
      name: "With Review",
      description: "Has review contract",
      category: "demo",
      mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
      missionTypes: [{
        type: "create_article",
        label: "Create article",
        payload: "{}",
        agentsMd: "create_article.md",
        review: { kind: reviewKind, server: "test-mcp", path: "/articles/{id}" },
      }],
    });
    const valid = validateManifest(manifest("markdown"));
    expect(valid.ok && valid.manifest.missionTypes?.find((entry) => entry.type === "create_article")?.review).toMatchObject({
      kind: "markdown",
      server: "test-mcp",
      path: "/articles/{id}",
    });
    expect(validateManifest(manifest("html"))).toMatchObject({ ok: false });
  });

  // Regression coverage for a top-level leaf field alongside a group with a
  // single optional password field — the shape SEO's requirements used to
  // exercise before issue #320 shrank it to a single apiKey. Exercised here
  // against a synthetic manifest so this AgentManifest-type-contract test
  // doesn't depend on which real Template happens to have this shape today.
  it("exposes a top-level leaf field and a group with an optional password field, distinctly labeled", () => {
    const reqs = [
      { key: "articleBasePath", type: "text", label: "Blog URL path", required: false, placeholder: "/blog" },
      {
        type: "group",
        label: "Indexation",
        fields: [{ key: "indexerApiKey", type: "password", label: "SpeedyIndex API key", required: false }],
      },
    ] satisfies import("./types.js").RequirementField[];

    const articleBasePath = reqs.find((f) => f.type !== "group" && f.key === "articleBasePath");
    expect(articleBasePath).toBeDefined();
    if (articleBasePath && articleBasePath.type !== "group") {
      expect(articleBasePath.label).toBe("Blog URL path");
      expect(articleBasePath.label).not.toBe("Public path");
      expect(articleBasePath.required).toBe(false);
    }

    const indexation = reqs.find((f) => f.type === "group" && f.label === "Indexation");
    expect(indexation).toBeDefined();
    if (indexation && indexation.type === "group") {
      expect(indexation.fields).toHaveLength(1);
      const indexerField = indexation.fields[0];
      expect(indexerField.key).toBe("indexerApiKey");
      expect(indexerField.type).toBe("password");
      expect(indexerField.required).toBe(false);
    }
  });

  it("accepts a valid requirements array and rejects an invalid type discriminant", () => {
    const manifest = (requirements: unknown[]) => ({
      id: "t",
      name: "T",
      description: "Manifest",
      category: "demo",
      mcpServers: [],
      requirements,
    });
    const validRequirements = [
      { key: "domain", type: "text", label: "Domain", required: true },
      {
        key: "defaultFormat",
        type: "select",
        label: "Default format",
        required: false,
        defaultValue: "hook-plus-letter",
        options: [
          { value: "hook-plus-letter", label: "Hook + letter" },
          { value: "letter-only", label: "Letter only" },
        ],
      },
    ];
    const valid = validateManifest(manifest(validRequirements));
    expect(valid.ok && valid.manifest.requirements).toEqual(validRequirements);
    expect(
      validateManifest(manifest([{ key: "domain", type: "email", label: "Domain", required: true }])),
    ).toMatchObject({ ok: false });
    expect(
      validateManifest(
        manifest([{ key: "defaultFormat", type: "select", label: "Default format", required: false, options: [] }]),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateManifest(
        manifest([
          {
            key: "defaultFormat",
            type: "select",
            label: "Default format",
            required: false,
            options: [{ value: "hook-plus-letter" }],
          },
        ]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("flattens select fields as leaves", () => {
    expect(
      flattenRequirementFields([
        {
          type: "group",
          label: "Defaults",
          fields: [
            {
              key: "defaultFormat",
              type: "select",
              label: "Default format",
              required: false,
              options: [
                { value: "hook-plus-letter", label: "Hook + letter" },
                { value: "letter-only", label: "Letter only" },
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "defaultFormat",
        type: "select",
        label: "Default format",
        required: false,
        options: [
          { value: "hook-plus-letter", label: "Hook + letter" },
          { value: "letter-only", label: "Letter only" },
        ],
      },
    ]);
  });
});

describe("requirement delivered to the Instance (issue #658)", () => {
  const manifestWith = (...fields: Array<Record<string, unknown>>) => ({
    id: "delivers",
    name: "Delivers",
    description: "Declares a delivered requirement",
    category: "demo",
    mcpServers: [],
    requirements: [
      fields[0],
      ...(fields.length > 1 ? [{ type: "group", label: "Group", fields: fields.slice(1) }] : []),
    ],
  });
  const secret = { key: "token", type: "password", label: "Token", required: true, deliveredToInstance: true };
  const other = { key: "other", type: "password", label: "Other", required: false };

  it("accepts a requirement marked deliveredToInstance, also inside a group", () => {
    expect(validateManifest(manifestWith(other, secret)).ok).toBe(true);
  });

  it("rejects a non-boolean deliveredToInstance", () => {
    expect(validateManifest(manifestWith({ ...secret, deliveredToInstance: "yes" })).ok).toBe(false);
  });

  it("rejects two delivered requirements: the Instance has a single delivery channel", () => {
    const second = { ...secret, key: "token2" };
    expect(validateManifest(manifestWith(secret, second))).toMatchObject({ ok: false });
  });

  it("deliveredRequirementField returns the marked leaf field, or undefined", () => {
    const parsed = validateManifest(manifestWith(other, secret));
    if (!parsed.ok) throw new Error("expected a valid manifest");
    expect(deliveredRequirementField(parsed.manifest)?.key).toBe("token");
    const plain = validateManifest(manifestWith(other));
    if (!plain.ok) throw new Error("expected a valid manifest");
    expect(deliveredRequirementField(plain.manifest)).toBeUndefined();
  });
});
