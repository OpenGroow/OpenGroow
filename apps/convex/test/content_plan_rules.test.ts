import { describe, expect, it } from "vitest";
import { CONTENT_PLAN_LIMITS, parseContentPlanEnvelope } from "../content_plan_rules";

// Issue #176: the shape and limits of what a Content Planning Run returns (ADR-086), without any database.

const PERIOD = { periodStart: "2030-03-05", periodEnd: "2030-03-11" };
const item = (over: Record<string, unknown> = {}) => ({
  missionType: "make_video", recipeId: "recipe-1", title: "A title", brief: "A brief", plannedAt: "2030-03-06", intent: "exploit", rationale: "Why", ...over,
});
const envelope = (over: Record<string, unknown> = {}) => ({ rationale: "Plan", items: [item()], ...over });

describe("parseContentPlanEnvelope", () => {
  it("accepts a well-formed result and an empty items list", () => {
    expect(parseContentPlanEnvelope(envelope(), PERIOD)).toMatchObject({ ok: true, value: { rationale: "Plan", items: [{ title: "A title", intent: "exploit" }] } });
    expect(parseContentPlanEnvelope(envelope({ items: [] }), PERIOD)).toMatchObject({ ok: true, value: { items: [] } });
  });

  it("rejects what is not an object, or lacks a rationale or items", () => {
    expect(parseContentPlanEnvelope("x", PERIOD)).toMatchObject({ ok: false });
    expect(parseContentPlanEnvelope(envelope({ rationale: " " }), PERIOD)).toMatchObject({ ok: false, errors: [expect.stringContaining("rationale")] });
    expect(parseContentPlanEnvelope({ rationale: "r" }, PERIOD)).toMatchObject({ ok: false, errors: [expect.stringContaining("items")] });
  });

  it("names every faulty item with its position", () => {
    const result = parseContentPlanEnvelope(
      envelope({ items: [item(), item({ title: "" }), item({ intent: "maybe" }), item({ plannedAt: "2030-03-12" }), item({ plannedAt: "2030-02-30" })] }),
      PERIOD,
    );
    expect(result.ok).toBe(false);
    const errors = (result as { errors: string[] }).errors;
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/items\[1\].*title/);
    expect(errors[1]).toMatch(/items\[2\].*intent/);
    expect(errors[2]).toMatch(/items\[3\].*2030-03-05.*2030-03-11/);
    expect(errors[3]).toMatch(/items\[4\].*plannedAt/);
  });

  it("enforces the size limits and the item ceiling", () => {
    const over = (n: number) => "a".repeat(n + 1);
    const errors = (raw: unknown) => (parseContentPlanEnvelope(raw, PERIOD) as { errors: string[] }).errors;
    expect(errors(envelope({ rationale: over(CONTENT_PLAN_LIMITS.rationaleChars) }))[0]).toMatch(/rationale/);
    expect(errors(envelope({ items: [item({ brief: over(CONTENT_PLAN_LIMITS.briefChars) })] }))[0]).toMatch(/brief/);
    expect(errors(envelope({ items: [item({ rationale: over(CONTENT_PLAN_LIMITS.itemRationaleChars) })] }))[0]).toMatch(/rationale/);
    expect(errors(envelope({ items: [item({ title: over(CONTENT_PLAN_LIMITS.titleChars) })] }))[0]).toMatch(/title/);
    expect(errors(envelope({ items: Array.from({ length: CONTENT_PLAN_LIMITS.items + 1 }, () => item()) }))[0]).toMatch(/100/);
  });

  it("ignores any status, project, period or publish target the Agent adds", () => {
    const parsed = parseContentPlanEnvelope(envelope({ status: "approved", instanceId: "x", items: [item({ publishTargets: ["a:b"], status: "approved" })] }), PERIOD);
    expect(parsed).toMatchObject({ ok: true });
    expect(JSON.stringify(parsed)).not.toMatch(/approved|publishTargets|instanceId/);
  });
});
