import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
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

const INSTANCE_ID = "openclaw-instance-nametest";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-name", subject: "owner-name" };

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

describe("mission name — auto-derivation and optional field", () => {
  it("succeeds and derives a default name when name is omitted", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission).not.toBeNull();
    // Derived name is non-empty and contains the type and mission number.
    expect(typeof mission!.name).toBe("string");
    expect(mission!.name!.length).toBeGreaterThan(0);
    expect(mission!.name).toContain("create_article");
    expect(mission!.name).toContain("#1");
  });

  it("succeeds and derives a default name when name is an empty string", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      name: "",
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission).not.toBeNull();
    expect(typeof mission!.name).toBe("string");
    expect(mission!.name!.length).toBeGreaterThan(0);
    expect(mission!.name).toContain("create_article");
  });

  it("succeeds and derives a default name when name is whitespace-only", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      name: "   ",
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission).not.toBeNull();
    expect(typeof mission!.name).toBe("string");
    expect(mission!.name!.length).toBeGreaterThan(0);
    // The whitespace was stripped so the derived name was used instead.
    expect(mission!.name).not.toBe("   ");
  });

  it("persists the supplied name on the mission when non-empty", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      name: "My SEO Article",
    });

    const mission = await t.withIdentity(OWNER).query(api.missions.get, { missionId });
    expect(mission?.name).toBe("My SEO Article");
  });

  it("sequential missions get incrementing numbers in their derived names", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { missionId: id1 } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
    });
    const { missionId: id2 } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
    });

    const m1 = await t.withIdentity(OWNER).query(api.missions.get, { missionId: id1 });
    const m2 = await t.withIdentity(OWNER).query(api.missions.get, { missionId: id2 });
    expect(m1!.name).toContain("#1");
    expect(m2!.name).toContain("#2");
  });
});
