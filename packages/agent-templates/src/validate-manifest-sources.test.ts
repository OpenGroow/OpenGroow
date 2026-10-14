import { describe, it, expect } from "vitest";
import { validateManifest } from "./index.js";

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    keyword: { type: "string", title: "Keyword" },
    volume: { type: "number", minimum: 0 },
    related: { type: "array", items: { type: "object", properties: { q: { type: "string" } } } },
  },
  required: ["keyword"],
};

const POLLING_CORE = {
  server: "test-mcp",
  mcpTool: "get_status",
  statusField: "status",
  terminalStates: { completed: ["done"], failed: ["error"] },
};

function source(overrides: Record<string, unknown> = {}) {
  return {
    type: "keyword_analysis",
    label: "Keyword analysis",
    family: "search",
    agentsMd: "sources/keyword_analysis.md",
    analysisSchema: ANALYSIS_SCHEMA,
    ...overrides,
  };
}

const BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [{ name: "test-mcp", transport: "streamable-http", url: "http://localhost/mcp" }],
};

function reasonOf(manifest: unknown): string {
  const result = validateManifest(manifest);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("validateManifest — sources", () => {
  it("accepts a manifest without sources", () => {
    expect(validateManifest(BASE).ok).toBe(true);
  });

  it("accepts valid sources with enrichment using only the polling core", () => {
    const result = validateManifest({
      ...BASE,
      sources: [source()],
      externalJobsBySource: { keyword_analysis: { analyze: POLLING_CORE } },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts every keyword of the allow-list", () => {
    const result = validateManifest({
      ...BASE,
      sources: [
        source({
          analysisSchema: {
            type: "object",
            title: "T",
            description: "d",
            additionalProperties: false,
            required: ["a"],
            properties: {
              a: { type: "string", minLength: 1, maxLength: 9, pattern: "^a", format: "uri", default: "x", const: "x" },
              b: { type: "number", minimum: 0, maximum: 5, exclusiveMinimum: 0, exclusiveMaximum: 6, enum: [1, 2] },
              c: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
            },
          },
        }),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate source types", () => {
    const reason = reasonOf({
      ...BASE,
      sources: [source(), source({ agentsMd: "sources/other.md" })],
    });
    expect(reason).toMatch(/duplicate/i);
    expect(reason).toContain("keyword_analysis");
  });

  it.each([
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "$ref",
    "patternProperties",
    "propertyNames",
    "contains",
    "prefixItems",
    "multipleOf",
    "uniqueItems",
    "dependentRequired",
    "dependentSchemas",
    "unevaluatedProperties",
    "unevaluatedItems",
    "$defs",
    "minProperties",
  ])("rejects an analysis schema using %s, nested, naming keyword and path", (keyword) => {
    const reason = reasonOf({
      ...BASE,
      sources: [
        source({
          analysisSchema: {
            type: "object",
            properties: { deep: { type: "array", items: { type: "object", [keyword]: {} } } },
          },
        }),
      ],
    });
    expect(reason).toContain(`"${keyword}"`);
    expect(reason).toContain("keyword_analysis");
    expect(reason).toContain("properties.deep.items");
  });

  it("rejects a top-level unsupported keyword", () => {
    expect(reasonOf({ ...BASE, sources: [source({ analysisSchema: { type: "object", oneOf: [] } })] })).toContain(
      '"oneOf" at $',
    );
  });

  it("rejects tuple-form 'items' and non-boolean additionalProperties", () => {
    const tuple = reasonOf({
      ...BASE,
      sources: [source({ analysisSchema: { type: "object", properties: { p: { type: "array", items: [{ type: "string" }] } } } })],
    });
    expect(tuple).toContain("properties.p.items");
    const addl = reasonOf({
      ...BASE,
      sources: [source({ analysisSchema: { type: "object", additionalProperties: { type: "string" } } })],
    });
    expect(addl).toContain("additionalProperties");
  });

  it("does not confuse a property named 'not' with the keyword", () => {
    const result = validateManifest({
      ...BASE,
      sources: [source({ analysisSchema: { type: "object", properties: { not: { type: "string" } } } })],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an analysis schema that is not an object schema", () => {
    expect(reasonOf({ ...BASE, sources: [source({ analysisSchema: { type: "string" } })] })).toMatch(
      /analysisSchema.*type "object"/,
    );
  });

  it("rejects an external-jobs server not declared in mcpServers", () => {
    const reason = reasonOf({
      ...BASE,
      sources: [source()],
      externalJobsBySource: { keyword_analysis: { analyze: { ...POLLING_CORE, server: "ghost-mcp" } } },
    });
    expect(reason).toContain("ghost-mcp");
    expect(reason).toMatch(/not declared/);
  });

  it("rejects an absent or unsafe agentsMd path", () => {
    expect(reasonOf({ ...BASE, sources: [source({ agentsMd: undefined })] })).toMatch(/agentsMd/);
    expect(reasonOf({ ...BASE, sources: [source({ agentsMd: "../secret.md" })] })).toMatch(/agentsMd/);
  });

  it("rejects enrichment referencing an unknown source", () => {
    const reason = reasonOf({
      ...BASE,
      sources: [source()],
      externalJobsBySource: { nope: { analyze: POLLING_CORE } },
    });
    expect(reason).toContain("nope");
    expect(reason).toMatch(/unknown Source/);
  });

  it("rejects a malformed polling core", () => {
    const reason = reasonOf({
      ...BASE,
      sources: [source()],
      externalJobsBySource: { keyword_analysis: { analyze: { server: "test-mcp" } } },
    });
    expect(reason).toMatch(/externalJobsBySource/);
  });

  it("rejects a source missing type, label or family", () => {
    expect(reasonOf({ ...BASE, sources: [source({ type: "" })] })).toMatch(/sources/);
    expect(reasonOf({ ...BASE, sources: [source({ label: undefined })] })).toMatch(/sources/);
    expect(reasonOf({ ...BASE, sources: [source({ family: 3 })] })).toMatch(/sources/);
  });

  it("rejects an agentsMd shared by two sources", () => {
    const reason = reasonOf({
      ...BASE,
      sources: [source(), source({ type: "other" })],
    });
    expect(reason).toContain("sources/keyword_analysis.md");
    expect(reason).toContain("other");
  });

  it("rejects a source agentsMd already used by a mission type", () => {
    const reason = reasonOf({
      ...BASE,
      missionTypes: [{ type: "m1", label: "M1", payload: "", agentsMd: "sources/keyword_analysis.md" }],
      sources: [source()],
    });
    expect(reason).toContain("sources/keyword_analysis.md");
    expect(reason).toContain("keyword_analysis");
    expect(reason).toMatch(/mission type/i);
  });
});
