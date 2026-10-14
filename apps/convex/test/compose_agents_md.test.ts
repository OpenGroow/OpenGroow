import { describe, expect, it } from "vitest";
import { AGENTS_MD_INLINE_LIMIT, composeAgentsMd } from "../mission_dispatcher/compose_agents_md.js";

describe("composeAgentsMd", () => {
  it("returns the base alone without Mission instructions", () => {
    expect(composeAgentsMd("base", undefined, "engage.md")).toBe("base");
  });

  it("inlines short Mission instructions", () => {
    expect(composeAgentsMd("base", "steps", "engage.md")).toBe("base\n\n---\n\nsteps");
  });

  it("points at the instruction file when inlining would exceed the injection limit", () => {
    const out = composeAgentsMd("base", "x".repeat(AGENTS_MD_INLINE_LIMIT), "engage.md");
    expect(out).toContain("`engage.md`");
    expect(out.length).toBeLessThan(AGENTS_MD_INLINE_LIMIT);
  });

  it("inlines when no file path is known", () => {
    const long = "x".repeat(AGENTS_MD_INLINE_LIMIT);
    expect(composeAgentsMd("base", long, undefined)).toContain(long);
  });
});
