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

const INSTANCE_A = "openclaw-instance-numtest-a";
const INSTANCE_B = "openclaw-instance-numtest-b";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER_A = { name: "Owner A", email: "a@example.com", tokenIdentifier: "test|owner-na", subject: "owner-na" };
const OWNER_B = { name: "Owner B", email: "b@example.com", tokenIdentifier: "test|owner-nb", subject: "owner-nb" };

async function seedInstance(t: ReturnType<typeof convexTest>, instanceId: string, userId: string) {
  const now = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${instanceId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: instanceId,
      updatedAt: now,
      userId,
    });
    await ctx.db.insert("projectAgents", {
      instanceId,
      templateId: TEMPLATE_ID,
      status: "active",
      openclawAgentName: TEMPLATE_ID,
      mcpServerKeys: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function createMission(t: ReturnType<typeof convexTest>, instanceId: string, owner: typeof OWNER_A) {
  return t.withIdentity(owner).mutation(api.missions.create, {
    instanceId,
    templateId: TEMPLATE_ID,
    type: "create_article",
    payload: { keyword: "test" },
    name: "Test Mission",
  });
}

describe("mission sequential numbering", () => {
  it("assigns number 1 to the first mission in a project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE_A, OWNER_A.subject);

    const { missionId } = await createMission(t, INSTANCE_A, OWNER_A);

    const mission = await t.withIdentity(OWNER_A).query(api.missions.get, { missionId });
    expect(mission?.number).toBe(1);
  });

  it("assigns sequential numbers to successive missions in the same project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE_A, OWNER_A.subject);

    const r1 = await createMission(t, INSTANCE_A, OWNER_A);
    const r2 = await createMission(t, INSTANCE_A, OWNER_A);
    const r3 = await createMission(t, INSTANCE_A, OWNER_A);

    const [m1, m2, m3] = await Promise.all([
      t.withIdentity(OWNER_A).query(api.missions.get, { missionId: r1.missionId }),
      t.withIdentity(OWNER_A).query(api.missions.get, { missionId: r2.missionId }),
      t.withIdentity(OWNER_A).query(api.missions.get, { missionId: r3.missionId }),
    ]);

    expect(m1?.number).toBe(1);
    expect(m2?.number).toBe(2);
    expect(m3?.number).toBe(3);
  });

  it("numbers are independent per project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE_A, OWNER_A.subject);
    await seedInstance(t, INSTANCE_B, OWNER_B.subject);

    const rA = await createMission(t, INSTANCE_A, OWNER_A);
    const rB = await createMission(t, INSTANCE_B, OWNER_B);

    const [mA, mB] = await Promise.all([
      t.withIdentity(OWNER_A).query(api.missions.get, { missionId: rA.missionId }),
      t.withIdentity(OWNER_B).query(api.missions.get, { missionId: rB.missionId }),
    ]);

    expect(mA?.number).toBe(1);
    expect(mB?.number).toBe(1);
  });

  it("backfill assigns numbers by createdAt order within each project", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE_A, OWNER_A.subject);
    await seedInstance(t, INSTANCE_B, OWNER_B.subject);

    // Insert unnumbered missions directly (simulating pre-existing data)
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("missions", {
        ownerId: OWNER_A.subject,
        instanceId: INSTANCE_A,
        templateId: TEMPLATE_ID,
        type: "seo_article",
        payload: {},
        status: "done",
        createdAt: now - 2000,
        updatedAt: now,
      });
      await ctx.db.insert("missions", {
        ownerId: OWNER_A.subject,
        instanceId: INSTANCE_A,
        templateId: TEMPLATE_ID,
        type: "seo_article",
        payload: {},
        status: "done",
        createdAt: now - 1000,
        updatedAt: now,
      });
      await ctx.db.insert("missions", {
        ownerId: OWNER_B.subject,
        instanceId: INSTANCE_B,
        templateId: TEMPLATE_ID,
        type: "seo_article",
        payload: {},
        status: "todo",
        createdAt: now - 500,
        updatedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.missions.backfillNumbers, {});
    });

    const missionsA = await t.run(async (ctx) => {
      return ctx.db
        .query("missions")
        .withIndex("by_instance_template", (q) => q.eq("instanceId", INSTANCE_A))
        .collect();
    });
    const missionsB = await t.run(async (ctx) => {
      return ctx.db
        .query("missions")
        .withIndex("by_instance_template", (q) => q.eq("instanceId", INSTANCE_B))
        .collect();
    });

    const numsA = missionsA.map((m) => m.number).sort();
    const numsB = missionsB.map((m) => m.number).sort();

    expect(numsA).toEqual([1, 2]);
    expect(numsB).toEqual([1]);
  });

  it("backfill does not overwrite already-numbered missions", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE_A, OWNER_A.subject);

    const { missionId } = await createMission(t, INSTANCE_A, OWNER_A);

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.missions.backfillNumbers, {});
    });

    const mission = await t.withIdentity(OWNER_A).query(api.missions.get, { missionId });
    expect(mission?.number).toBe(1);
  });
});
