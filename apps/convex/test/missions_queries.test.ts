import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-q";
const TEMPLATE_ID = "@opengroow/seo";

const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-q", subject: "owner-q" };
const STRANGER = { name: "Stranger", email: "s@example.com", tokenIdentifier: "test|stranger-q", subject: "stranger-q" };

async function seedAll(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
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
  return await t.withIdentity(OWNER).mutation(api.missions.create, {
    instanceId: INSTANCE_ID,
    templateId: TEMPLATE_ID,
    type: "create_article",
    payload: { keyword: "x" },
    name: "Test Mission",
  });
}

describe("missions.get", () => {
  it("returns the mission for the owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission?._id).toBe(missionId);
  });

  it("returns null for a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const mission = await t.withIdentity(STRANGER).query(api.missions.get, { missionId });
    expect(mission).toBeNull();
  });
});

describe("missions.listActiveByInstance", () => {
  it("returns missions for the owner", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const list = await t.withIdentity(OWNER).query(api.missions.listActiveByInstance, { instanceId: INSTANCE_ID });
    expect(list.length).toBe(1);
  });

  it("returns empty for a non-owner", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const list = await t.withIdentity(STRANGER).query(api.missions.listActiveByInstance, { instanceId: INSTANCE_ID });
    expect(list).toEqual([]);
  });

  it("excludes done missions", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(missionId, { status: "done" });
    });
    const list = await t.withIdentity(OWNER).query(api.missions.listActiveByInstance, { instanceId: INSTANCE_ID });
    expect(list).toEqual([]);
  });
});

describe("missions.listDoneByInstance", () => {
  const FIRST_PAGE = { numItems: 10, cursor: null };

  it("returns done missions for the owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(missionId, { status: "done" });
    });
    const result = await t
      .withIdentity(OWNER)
      .query(api.missions.listDoneByInstance, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page.length).toBe(1);
  });

  it("returns an empty finished page for a non-owner", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const result = await t
      .withIdentity(STRANGER)
      .query(api.missions.listDoneByInstance, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});

describe("runs.get", () => {
  it("returns the run for the owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const list = await t.withIdentity(OWNER).query(api.runs.listByMission, { missionId });
    const runId = list[0]._id;
    const run = await t.withIdentity(OWNER).query(api.runs.get, { runId });
    expect(run?._id).toBe(runId);
  });

  it("returns null for a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const list = await t.withIdentity(OWNER).query(api.runs.listByMission, { missionId });
    const runId = list[0]._id;
    const run = await t.withIdentity(STRANGER).query(api.runs.get, { runId });
    expect(run).toBeNull();
  });
});

describe("runs.listByMission", () => {
  it("returns runs for the owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const list = await t.withIdentity(OWNER).query(api.runs.listByMission, { missionId });
    expect(list.length).toBe(1);
    expect(list[0].status).toBe("pending");
  });

  it("returns empty for a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { missionId } = await seedAll(t);
    const list = await t.withIdentity(STRANGER).query(api.runs.listByMission, { missionId });
    expect(list).toEqual([]);
  });

  it("omits agentsMdSnapshot/contextMdSnapshot — unused by any current caller, kept only on runs.get (ADR-050)", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedAll(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        agentsMdSnapshot: "# Agent instructions",
        contextMdSnapshot: "# Brand Core",
      });
    });
    const list = await t.withIdentity(OWNER).query(api.runs.listByMission, { missionId });
    expect(list[0]).not.toHaveProperty("agentsMdSnapshot");
    expect(list[0]).not.toHaveProperty("contextMdSnapshot");
    // Still available through the single-Run query.
    const run = await t.withIdentity(OWNER).query(api.runs.get, { runId });
    expect(run?.agentsMdSnapshot).toBe("# Agent instructions");
  });
});
