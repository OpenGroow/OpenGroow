import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { planItemErrors } from "../plan";
import { PLAN_MAX_ITEMS, planSizeError, type PlanItem } from "../plan_schema";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

const modules = { "../_generated/api.ts": () => import("../_generated/api.js") };
const INSTANCE_ID = "openclaw-plan-1";
const TEMPLATE_ID = "@example/maker";

useTemplateRegistry([INSTANCE_ID], [
  fixtureTemplate(TEMPLATE_ID, {
    missionTypes: [{ type: "create_article", label: "Article", payload: "{}", agentsMd: "a.md" }],
  }),
]);

const item = (overrides: Partial<PlanItem> = {}): PlanItem => ({
  type: "create_article",
  payload: {},
  reason: "Articles outperform the other formats",
  figures: [{ label: "Median views", value: 1200 }],
  ...overrides,
});

async function seedAgent(t: ReturnType<typeof convexTest>, status: "active" | "inactive" = "active") {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status,
      workspaceKey: "ws",
      openclawAgentName: "maker",
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

const check = (t: ReturnType<typeof convexTest>, items: PlanItem[]) =>
  t.run((ctx) => planItemErrors(ctx, INSTANCE_ID, items));

describe("planItemErrors", () => {
  it("accepts items that a manual creation would accept", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    expect(await check(t, [item(), item()])).toEqual([]);
  });

  it("refuses a Mission type that is not active, with the item's position", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const errors = await check(t, [item(), item({ type: "create_reel" })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 2 \(create_reel\).*not active/);
  });

  it("refuses a type whose agent was deactivated", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, "inactive");
    expect((await check(t, [item()]))[0]).toMatch(/item 1.*not active/);
  });

  it("refuses an unpublishable channel and an invalid schedule, each with its position", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const errors = await check(t, [
      item({ payload: { publishTargets: ["nowhere"] } }),
      item(),
      item({ payload: { publishAt: "tomorrow" } }),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/item 1.*nowhere/);
    expect(errors[1]).toMatch(/item 3.*publishAt/);
  });
});

describe("planSizeError", () => {
  it("refuses more than the maximum, and says so", () => {
    expect(planSizeError(new Array(PLAN_MAX_ITEMS).fill(0))).toBeUndefined();
    expect(planSizeError(new Array(PLAN_MAX_ITEMS + 1).fill(0))).toMatch(/6 items: at most 5/);
  });
});
