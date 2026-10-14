import { describe, expect, it } from "vitest";
import type { SourceDeclaration } from "@opengroow/agent-templates";
import { buildSourceJsonSchema, validateSourceWrite } from "../source_schema";

const keyword: SourceDeclaration = {
  type: "keyword",
  label: "Search keyword",
  family: "search",
  agentsMd: "sources/keyword.md",
  analysisSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 }, volume: { type: "integer", minimum: 0 } },
    required: ["query"],
    additionalProperties: false,
  },
};

const validBody = {
  templateId: "t",
  sourceId: "keyword",
  common: { origin: "https://example.com/a", capturedAt: 1_700_000_000_000, marketing: {} },
  analysis: { query: "zod", volume: 10 },
};

describe("validateSourceWrite", () => {
  it("accepts a valid payload", () => {
    const res = validateSourceWrite(keyword, validBody);
    expect(res.ok).toBe(true);
  });

  it("keeps case for summary, problem and intent (trim only)", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: { ...validBody.common, marketing: { summary: " Big Win ", problem: " Sore Feet ", intent: " Buy Now " } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.common.marketing.summary).toBe("Big Win");
      expect(res.value.common.marketing.problem).toBe("Sore Feet");
      expect(res.value.common.marketing.intent).toBe("Buy Now");
    }
  });

  it("accepts an optional raw string and rejects one above 64 KB with its path", () => {
    const ok = validateSourceWrite(keyword, { ...validBody, common: { ...validBody.common, raw: "x".repeat(65536) } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.common.raw).toHaveLength(65536);
    const bad = validateSourceWrite(keyword, { ...validBody, common: { ...validBody.common, raw: "x".repeat(65537) } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join("\n")).toContain("common.raw");
  });

  it("normalizes the marketing lists: trimmed and lower-cased", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: {
        ...validBody.common,
        marketing: { topics: ["  Running SHOES "] },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.common.marketing.topics).toEqual(["running shoes"]);
    }
  });

  it("accepts the whole marketing layer ADR-051 declares", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: {
        ...validBody.common,
        marketing: {
          summary: "a runner explains heel pain",
          topics: ["running"],
          audiences: ["beginners"],
          problem: "sore feet",
          intent: "educate",
          emotions: ["relief"],
          contentPatterns: ["talking head"],
          reproducibleElements: ["three-step list"],
          topicSpecificElements: ["shoe brand name"],
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it("reports an uncompilable declared analysis schema instead of throwing", () => {
    const broken: SourceDeclaration = {
      ...keyword,
      analysisSchema: { type: "object", properties: { q: { $ref: "https://example.com/other.json" } } },
    };
    const res = validateSourceWrite(broken, validBody);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toContain("analysis");
  });

  it("returns every error at once, in a readable form", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: { origin: "", capturedAt: "yesterday", marketing: { topics: "not-an-array" } },
      analysis: { volume: -1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const joined = res.errors.join("\n");
      expect(joined).toContain("common.origin");
      expect(joined).toContain("common.capturedAt");
      expect(joined).toContain("common.marketing.topics");
      expect(joined).toContain("analysis");
      expect(res.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("bounds marketing arrays in count and item length", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: {
        ...validBody.common,
        marketing: { topics: Array.from({ length: 50 }, (_, i) => `t${i}`), intent: "x".repeat(5000) },
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join("\n")).toContain("common.marketing.topics");
      expect(res.errors.join("\n")).toContain("common.marketing.intent");
    }
  });

  it.each(["status", "label", "family", "score", "replicationScore"])(
    "rejects a caller-set %s at the top level",
    (field) => {
      const res = validateSourceWrite(keyword, { ...validBody, [field]: "x" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.join("\n")).toContain(field);
    },
  );

  it("rejects scoring fields inside the common layer", () => {
    const res = validateSourceWrite(keyword, {
      ...validBody,
      common: { ...validBody.common, score: 1, status: "ready" },
    });
    expect(res.ok).toBe(false);
  });
});

describe("buildSourceJsonSchema", () => {
  it("merges the common layers and the Source's analysis schema", () => {
    const schema = buildSourceJsonSchema(keyword) as any;
    expect(schema.type).toBe("object");
    expect(schema.properties.sourceId.const).toBe("keyword");
    expect(schema.properties.analysis).toMatchObject(keyword.analysisSchema);
    expect(schema.properties.common.properties.origin.type).toBe("string");
    expect(schema.properties.common.properties.marketing.properties.topics.maxItems).toBeGreaterThan(0);
    expect(schema.required).toEqual(expect.arrayContaining(["sourceId", "common", "analysis"]));
  });
});
