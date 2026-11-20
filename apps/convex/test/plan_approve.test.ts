import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../plan.ts": () => import("../plan.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-plan-approve";
const STRATEGY = "@example/strategy";
const CONTENT = "@example/content";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|plan", subject: "plan-owner" };

useTemplateRegistry([INSTANCE_ID], [
  fixtureTemplate(STRATEGY, {
    missionTypes: [
      {
        type: "plan",
        label: "Plan",
        payload: "{}",
        agentsMd: "plan.md",
        review: {
          kind: "plan",
          actions: [
            {
              key: "approve",
              label: "Approve",
              requiredStatus: "to_validate",
              inputs: [{ key: "items", label: "Items", type: "plan_selection", required: false }],
              effect: { kind: "approve_plan", selectionKey: "items" },
              transition: "done",
            },
          ],
        },
      },
    ],
  }),
  fixtureTemplate(CONTENT, {
    missionTypes: [
      { type: "create_article", label: "Article", payload: "{}", agentsMd: "article.md" },
      { type: "create_reel", label: "Reel", payload: "{}", agentsMd: "reel.md" },
    ],
  }),
]);

const items = [
  { type: "create_article", payload: { topic: "pricing" }, reason: "Articles win", figures: [{ label: "Median views", value: 1200 }] },
  { type: "create_reel", payload: { topic: "demo" }, reason: "Reels reach new people", figures: [{ label: "Reach", value: "5k" }] },
  { type: "create_article", payload: { topic: "faq" }, reason: "Support asks it", figures: [{ label: "Tickets", value: 14 }] },
];

async function seed(t: ReturnType<typeof convexTest>, options: { contentAgentStatus?: "active" | "inactive" } = {}) {
  return t.run(async (ctx) => {
    const iso = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: "job-plan",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: iso,
      openclawId: INSTANCE_ID,
      updatedAt: iso,
      userId: OWNER.subject,
    });
    const now = Date.now();
    for (const [templateId, name, status] of [
      [STRATEGY, "strategy", "active"],
      [CONTENT, "content", options.contentAgentStatus ?? "active"],
    ] as const) {
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId,
        status,
        openclawAgentName: name,
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: STRATEGY,
      type: "plan",
      payload: {},
      status: "to_validate",
      lastResult: { status: "needs_human_review", summary: "Next week", reviewQuestions: [], plan: items },
      createdAt: now,
      updatedAt: now,
    });
  });
}

const approve = (t: ReturnType<typeof convexTest>, missionId: Id<"missions">, input?: Record<string, string>) =>
  t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
    missionId,
    actionKey: "approve",
    ...(input ? { input } : {}),
  });

const createdMissions = (t: ReturnType<typeof convexTest>, planMissionId: Id<"missions">) =>
  t.run(async (ctx) => {
    const all = await ctx.db.query("missions").collect();
    return all.filter((m) => m._id !== planMissionId);
  });

describe("approving a Plan", () => {
  it("creates and launches every item when nothing is unselected", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);

    await approve(t, planId);

    const created = await createdMissions(t, planId);
    expect(created.map((m) => [m.type, m.payload, m.status, m.templateId])).toEqual([
      ["create_article", { topic: "pricing" }, "todo", CONTENT],
      ["create_reel", { topic: "demo" }, "todo", CONTENT],
      ["create_article", { topic: "faq" }, "todo", CONTENT],
    ]);
    await t.run(async (ctx) => {
      for (const mission of created) {
        const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", mission._id)).collect();
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: "pending", agentName: "content" });
      }
      const plan = await ctx.db.get(planId);
      expect(plan?.status).toBe("done");
      expect(plan?.declinedPlanItems ?? []).toEqual([]);
    });
  });

  it("names the Missions like a manual creation and keeps the reason, the figures and the Plan Mission on each", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);

    await approve(t, planId);

    const created = await createdMissions(t, planId);
    expect(created[1]?.name).toMatch(/^create_reel #\d+$/);
    expect(created[1]?.fromPlan).toEqual({ missionId: planId, reason: "Reels reach new people", figures: [{ label: "Reach", value: "5k" }] });
  });

  it("creates only the selected items and records the others as declined on the Plan Mission", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);

    await approve(t, planId, { items: "[0,2]" });

    const created = await createdMissions(t, planId);
    expect(created.map((m) => m.payload)).toEqual([{ topic: "pricing" }, { topic: "faq" }]);
    await t.run(async (ctx) => {
      const plan = await ctx.db.get(planId);
      expect(plan?.declinedPlanItems).toEqual([items[1]]);
      expect(plan?.status).toBe("done");
    });
  });

  it("refuses an item the Project can no longer run, creates nothing and leaves the Plan to review", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t, { contentAgentStatus: "inactive" });

    await expect(approve(t, planId)).rejects.toThrow(/plan item 1 \(create_article\).*not active/);

    expect(await createdMissions(t, planId)).toEqual([]);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(planId))?.status).toBe("to_validate");
    });
  });

  it("does not hold an invalid item that the user unselected against the others", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(planId, {
        lastResult: {
          status: "needs_human_review",
          summary: "s",
          reviewQuestions: [],
          plan: [items[0]!, { ...items[1]!, type: "create_podcast" }],
        },
      });
    });

    await expect(approve(t, planId)).rejects.toThrow(/plan item 2 \(create_podcast\).*not active in this Project/);
    expect(await createdMissions(t, planId)).toEqual([]);

    await approve(t, planId, { items: "[0]" });
    expect((await createdMissions(t, planId)).map((m) => m.type)).toEqual(["create_article"]);
  });

  it("refuses an empty selection and a position the Plan does not have", async () => {
    const t = convexTest(schema, modules);
    const planId = await seed(t);

    await expect(approve(t, planId, { items: "[]" })).rejects.toThrow(/at least one item/);
    await expect(approve(t, planId, { items: "[7]" })).rejects.toThrow(/no item 8/);
    await expect(approve(t, planId, { items: "oops" })).rejects.toThrow(/selection/);
    expect(await createdMissions(t, planId)).toEqual([]);
  });
});
