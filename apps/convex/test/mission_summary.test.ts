import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../events.ts": () => import("../events.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../mission_summary_http.ts": () => import("../mission_summary_http.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runs.ts": () => import("../runs.js"),
};

const INSTANCE_ID = "openclaw-instance-summary-test";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER = {
  name: "Owner",
  email: "o@example.com",
  tokenIdentifier: "test|owner-summary",
  subject: "owner-summary",
};

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      openclawAgentName: TEMPLATE_ID,
      mcpServerKeys: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function createMission(t: ReturnType<typeof convexTest>) {
  return t.withIdentity(OWNER).mutation(api.missions.create, {
    instanceId: INSTANCE_ID,
    templateId: TEMPLATE_ID,
    type: "create_article",
    payload: { keyword: "test" },
    name: "Test Mission",
  });
}

describe("mission writeSummary", () => {
  it("writes the summary on the mission", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { missionId } = await createMission(t);

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.missions.writeSummary, {
        missionId,
        summary: "Article about running shoes for Q1",
      });
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission?.summary).toBe("Article about running shoes for Q1");
  });

  it("does not change the mission status", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { missionId } = await createMission(t);

    const before = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    const originalStatus = before?.status;

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.missions.writeSummary, {
        missionId,
        summary: "Some summary",
      });
    });

    const after = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(after?.status).toBe(originalStatus);
  });

  it("can overwrite an existing summary", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { missionId } = await createMission(t);

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.missions.writeSummary, {
        missionId,
        summary: "First summary",
      });
      await ctx.runMutation(internal.missions.writeSummary, {
        missionId,
        summary: "Updated summary",
      });
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission?.summary).toBe("Updated summary");
  });
});
