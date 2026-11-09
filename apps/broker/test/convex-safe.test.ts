import { describe, it, expect } from "vitest";
import { convexToJson } from "convex/values";
import { convexSafe, convexSafeKey } from "../src/convex-safe.js";

describe("convexSafe", () => {
  it("makes an event with a JSON Schema storable by Convex, where it was refused", () => {
    const toolResult = {
      type: "toolResult",
      content: {
        $schema: "http://json-schema.org/draft-07/schema#",
        properties: { hook: { $ref: "#/$defs/hook" } },
        $defs: { hook: { type: "object" } },
      },
    };
    expect(() => convexToJson(toolResult as never)).toThrow(/starts with a '\$'/);

    const safe = convexSafe(toolResult);
    expect(() => convexToJson(safe as never)).not.toThrow();
    expect(safe.content).toEqual({
      "%24schema": "http://json-schema.org/draft-07/schema#",
      properties: { hook: { "%24ref": "#/$defs/hook" } },
      "%24defs": { hook: { type: "object" } },
    });
  });

  it("escapes names Convex refuses for another reason: non-ASCII and control characters, over-long names", () => {
    expect(convexSafeKey("é")).toBe("%C3%A9");
    expect(convexSafeKey("a\nb")).toBe("a%0Ab");
    expect(convexSafeKey("😀")).toBe("%F0%9F%98%80");
    expect(convexSafeKey("\ud800")).toBe("%EF%BF%BD");
    expect(convexSafeKey("x".repeat(2000))).toHaveLength(1024);
  });

  it("keeps valid names, values and arrays as they are, and walks into arrays", () => {
    const event = { id: "1", type: "t", ts: 5, payload: { turns: [{ role: "user", n: 1, ok: true, none: null }] } };
    expect(convexSafe(event)).toEqual(event);
    expect(convexSafe([{ $a: 1 }])).toEqual([{ "%24a": 1 }]);
  });

  it("keeps both values when two names escape to the same one", () => {
    expect(convexSafe({ $a: 1, "%24a": 2 })).toEqual({ "%24a": 1, "%24a_": 2 });
  });
});
