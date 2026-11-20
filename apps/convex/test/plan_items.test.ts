import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { basedOnNumbers, planItemErrors } from "../plan";
import { PLAN_MAX_ITEMS, planSizeError, type PlanItem } from "../plan_schema";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

import { seedMission, seedPublishingProject } from "./helpers/measured_missions.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../instances.ts": () => import("../instances.js"),
};
const OTHER_INSTANCE_ID = "openclaw-plan-2";
const INSTANCE_ID = "openclaw-plan-1";
const TEMPLATE_ID = "@example/maker";

useTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], [
  fixtureTemplate(TEMPLATE_ID, {
    missionTypes: [
      { type: "create_article", label: "Article", payload: "{}", agentsMd: "a.md" },
      { type: "plan_week", label: "Weekly plan", payload: "{}", agentsMd: "p.md", review: { kind: "plan" } },
    ],
  }),
]);

const item = (basedOn: string, overrides: Partial<PlanItem> = {}): PlanItem => ({
  type: "create_article",
  basedOn,
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

/** A Project whose one Mission is done and measured: what an item may be based on. */
async function seedBase(t: ReturnType<typeof convexTest>) {
  await seedPublishingProject(t, INSTANCE_ID);
  return seedMission(t, INSTANCE_ID, { measured: true });
}

const check = (t: ReturnType<typeof convexTest>, items: PlanItem[]) =>
  t.run((ctx) => planItemErrors(ctx, INSTANCE_ID, items));

describe("planItemErrors", () => {
  it("accepts items that a manual creation would accept", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const base = await seedBase(t);
    expect(await check(t, [item(base), item(base)])).toEqual([]);
  });

  it("refuses a Mission type that is not active, with the item's position", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const base = await seedBase(t);
    const errors = await check(t, [item(base), item(base, { type: "create_reel" })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 2 \(create_reel\).*not active/);
  });

  it("refuses a Plan item that is itself a Plan-review Mission type, with the item's position", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const base = await seedBase(t);
    const errors = await check(t, [item(base), item(base, { type: "plan_week" })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 2 \(plan_week\).*Plan/);
  });

  it("refuses a type whose agent was deactivated", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, "inactive");
    const base = await seedBase(t);
    expect((await check(t, [item(base)]))[0]).toMatch(/item 1.*not active/);
  });

  it("refuses an unpublishable channel and an invalid schedule, each with its position", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const base = await seedBase(t);
    const errors = await check(t, [
      item(base, { payload: { publishTargets: ["nowhere"] } }),
      item(base),
      item(base, { payload: { publishAt: "tomorrow" } }),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/item 1.*nowhere/);
    expect(errors[1]).toMatch(/item 3.*publishAt/);
  });
});

describe("planItemErrors: the Mission an item is based on", () => {
  it("accepts a done Mission of the Project with a measured Publication", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    expect(await check(t, [item(await seedBase(t))])).toEqual([]);
  });

  it("refuses a Mission that is not done, naming the item and the status", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    const base = await seedBase(t);
    const doing = await seedMission(t, INSTANCE_ID, { status: "doing", measured: true });
    const errors = await check(t, [item(base), item(doing)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 2 \(create_article\).*Mission #7.*not done.*doing/);
  });

  it("refuses a done Mission whose Publication has no measurement yet", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await seedPublishingProject(t, INSTANCE_ID);
    const unmeasured = await seedMission(t, INSTANCE_ID);
    expect((await check(t, [item(unmeasured)]))[0]).toMatch(/item 1.*Mission #7.*no measured Publication/);
  });

  it("refuses a done Mission that was never published", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await seedPublishingProject(t, INSTANCE_ID);
    const unpublished = await seedMission(t, INSTANCE_ID, { publish: false });
    expect((await check(t, [item(unpublished)]))[0]).toMatch(/item 1.*no measured Publication/);
  });

  it("refuses a Mission of another Project as if it did not exist, without saying anything about it", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await seedPublishingProject(t, OTHER_INSTANCE_ID);
    const foreign = await seedMission(t, OTHER_INSTANCE_ID, { measured: true });
    const errors = await check(t, [item(foreign)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 1.*not a Mission of this Project/);
    expect(errors[0]).not.toMatch(/Mission #|done|measured/);
  });

  it("refuses an id that is not a Mission id", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    expect((await check(t, [item("not-an-id")]))[0]).toMatch(/item 1.*not a Mission of this Project/);
  });
});

describe("basedOnNumbers", () => {
  it("gives the number of the Project's Missions only, for the review to name them", async () => {
    const t = convexTest(schema, modules);
    const own = await seedBase(t);
    await seedPublishingProject(t, OTHER_INSTANCE_ID);
    const foreign = await seedMission(t, OTHER_INSTANCE_ID, { measured: true });
    const numbers = await t.run((ctx) => basedOnNumbers(ctx, INSTANCE_ID, [own, foreign, "not-an-id"]));
    expect(numbers).toEqual({ [own]: 7 });
  });
});

describe("a Plan stored before basedOn existed", () => {
  it("still matches the schema, and its items are refused as having no measured origin", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await seedBase(t);
    // Written by an earlier version: no `basedOn` on the item. Storage must accept it.
    await t.run((ctx) =>
      ctx.db.insert("missions", {
        ownerId: "owner", instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "plan_week", name: "Old plan",
        payload: {}, status: "to_validate", number: 1, createdAt: 1, updatedAt: 1,
        lastResult: { status: "needs_human_review", summary: "old", reviewQuestions: [], plan: [{ type: "create_article", payload: {}, reason: "r", figures: [{ label: "x", value: 1 }] }] },
      } as never),
    );
    const legacy = { type: "create_article", payload: {}, reason: "r", figures: [{ label: "x", value: 1 }] } as unknown as PlanItem;
    const errors = await check(t, [legacy]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/plan item 1/);
    expect(errors[0]).toMatch(/basedOn is missing/);
  });
});

describe("planSizeError", () => {
  it("refuses more than the maximum, and says so", () => {
    expect(planSizeError(new Array(PLAN_MAX_ITEMS).fill(0))).toBeUndefined();
    expect(planSizeError(new Array(PLAN_MAX_ITEMS + 1).fill(0))).toMatch(/6 items: at most 5/);
  });
});
