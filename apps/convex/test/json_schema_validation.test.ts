import { describe, expect, it } from "vitest";
import { z } from "zod";

// ADR-051: Source analysis schemas are declared as JSON Schema and enforced by
// zod v4's `fromJSONSchema`. This pins the keyword subset the ADR relies on.
const analysisSchema: z.core.JSONSchema.JSONSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 20 },
    kind: { enum: ["organic", "paid"] },
    url: { type: "string", format: "uri" },
    rank: { type: "integer", minimum: 1, maximum: 100 },
    related: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: { title: { type: "string" }, url: { type: "string", format: "uri" } },
        required: ["title"],
      },
    },
  },
  required: ["query", "kind"],
};

const valid = {
  query: "zod",
  kind: "organic",
  url: "https://example.com/a",
  rank: 3,
  related: [{ title: "t", url: "https://example.com/b" }],
};

describe("z.fromJSONSchema", () => {
  const schema = z.fromJSONSchema(analysisSchema);

  it("accepts a conforming payload", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["missing required", { ...valid, query: undefined }],
    ["enum violation", { ...valid, kind: "other" }],
    ["invalid uri", { ...valid, url: "not a uri" }],
    ["below minimum", { ...valid, rank: 0 }],
    ["above maximum", { ...valid, rank: 101 }],
    ["too long", { ...valid, query: "x".repeat(21) }],
    ["too many items", { ...valid, related: [{ title: "a" }, { title: "b" }, { title: "c" }] }],
    ["nested missing required", { ...valid, related: [{ url: "https://example.com" }] }],
    ["nested invalid uri", { ...valid, related: [{ title: "a", url: "nope" }] }],
  ])("rejects %s", (_name, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });

  it("reports every violation, not just the first", () => {
    const r = schema.safeParse({ ...valid, kind: "x", rank: 0 });
    expect(r.success ? [] : r.error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("throws on unsupported keywords such as external $ref", () => {
    expect(() =>
      z.fromJSONSchema({ type: "object", properties: { a: { $ref: "https://x.test/s.json" } } }),
    ).toThrow();
  });
});
