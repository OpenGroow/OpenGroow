import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
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
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-plan-reject";
const TEMPLATE_ID = "@example/strategy";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|plan", subject: "plan-owner" };

useTemplateRegistry([INSTANCE_ID], [
  fixtureTemplate(TEMPLATE_ID, {
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
              key: "reject",
              label: "Reject",
              requiredStatus: "to_validate",
              inputs: [{ key: "feedback", label: "Feedback", type: "text", required: true }],
              effect: { kind: "revision_run", feedbackKey: "feedback" },
              transition: "doing",
            },
          ],
        },
      },
    ],
  }),
]);

const plan = [
  {
    type: "create_article",
    payload: {},
    reason: "Articles outperform the other formats",
    figures: [{ label: "Median views", value: 1200 }],
  },
];

describe("rejecting a Plan with a feedback", () => {
  it("starts a new Run of the same Mission that carries the feedback", async () => {
    const t = convexTest(schema, modules);
    const missionId = await t.run(async (ctx) => {
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
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        status: "active",
        openclawAgentName: "strategy",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "plan",
        payload: {},
        status: "to_validate",
        lastResult: { status: "needs_human_review", summary: "Next week", reviewQuestions: [], plan },
        createdAt: now,
        updatedAt: now,
      });
    });

    const feedback = "Two articles is too many, propose one reel instead.";
    const review = await t.withIdentity(OWNER).action(api.missions_node.getReview, { missionId });
    expect(review.plan).toEqual(plan);
    expect(review.actions.find((a) => a.key === "reject")?.enabled).toBe(true);

    await t.withIdentity(OWNER).action(api.missions_node.performReviewAction, {
      missionId,
      actionKey: "reject",
      input: { feedback },
    });

    await t.run(async (ctx) => {
      expect((await ctx.db.get(missionId))?.status).toBe("doing");
      const runs = await ctx.db.query("runs").withIndex("by_mission", (q) => q.eq("missionId", missionId)).collect();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "pending", humanFeedback: feedback });
    });
  });
});
