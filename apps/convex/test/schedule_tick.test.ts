import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

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
  "../schedules.ts": () => import("../schedules.js"),
};

const INSTANCE_ID = "openclaw-instance-tick";
const TEMPLATE_ID = "@opengroow/seo";
const OPENCLAW_AGENT = "seo";
const OWNER_ID = "owner-tick";

async function seedActiveAgent(t: ReturnType<typeof convexTest>, templateId = TEMPLATE_ID) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId,
      status: "active",
      workspaceKey: "ws-tick",
      openclawAgentName: templateId === TEMPLATE_ID ? OPENCLAW_AGENT : templateId,
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedSchedule(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    status: "active" | "paused";
    nextRunAt: number;
    templateId: string;
    type: string;
    autoPublish: boolean;
  }> = {},
): Promise<Id<"schedules">> {
  const now = Date.now();
  return t.run(async (ctx) => {
    return ctx.db.insert("schedules", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: overrides.templateId ?? TEMPLATE_ID,
      type: overrides.type ?? "create_article",
      payload: { keyword: "octopus" },
      ...(overrides.autoPublish !== undefined ? { autoPublish: overrides.autoPublish } : {}),
      unit: "daily",
      hour: 9,
      minute: 0,
      timezone: "Europe/Paris",
      status: overrides.status ?? "active",
      nextRunAt: overrides.nextRunAt ?? now - 1000, // due by default
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function missionCount(t: ReturnType<typeof convexTest>): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.query("missions").collect()).length);
}

describe("schedules tick — robustness & observability", () => {
  it("inactive agent: no mission created, lastError recorded, schedule still active, nextRunAt advanced", async () => {
    const t = convexTest(schema, modules);
    // No active agent seeded for this template.
    const scheduleId = await seedSchedule(t, { templateId: "no-agent" });

    const before = Date.now();
    await t.action(internal.schedules.tick, {});

    expect(await missionCount(t)).toBe(0);
    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.status).toBe("active");
      expect(sched!.lastError).toBeDefined();
      expect(sched!.lastRunAt).toBeGreaterThanOrEqual(before);
      expect(sched!.nextRunAt).toBeGreaterThan(before);
    });
  });

  it("successful tick clears a previous lastError", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    const scheduleId = await seedSchedule(t);
    // Seed a pre-existing error.
    await t.run(async (ctx) => {
      await ctx.db.patch(scheduleId, { lastError: "previous error" });
    });

    await t.action(internal.schedules.tick, {});

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.lastError).toBeUndefined();
      expect(sched!.lastMissionId).toBeDefined();
    });
  });

  it("fire-once / no catch-up: overdue by multiple slots creates one mission and nextRunAt is in the future", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    // Schedule overdue by 3 hours.
    await seedSchedule(t, { nextRunAt: Date.now() - 3 * 60 * 60 * 1000 });

    const before = Date.now();
    await t.action(internal.schedules.tick, {});

    expect(await missionCount(t)).toBe(1);
    await t.run(async (ctx) => {
      const [sched] = await ctx.db.query("schedules").collect();
      expect(sched!.nextRunAt).toBeGreaterThan(before);
    });
  });

  it("overlap: a previous unfinished mission does not prevent a new one from being created", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    const scheduleId = await seedSchedule(t);

    // Simulate a still-running mission from a prior tick.
    await t.run(async (ctx) => {
      const now = Date.now();
      const priorMissionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(scheduleId, { lastMissionId: priorMissionId });
    });

    await t.action(internal.schedules.tick, {});

    // Prior mission + new mission = 2.
    expect(await missionCount(t)).toBe(2);
  });
});

describe("schedules tick", () => {
  it("fires a due daily schedule: creates a Mission and advances nextRunAt into the future", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    const scheduleId = await seedSchedule(t);

    const before = Date.now();
    await t.action(internal.schedules.tick, {});

    expect(await missionCount(t)).toBe(1);
    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.nextRunAt).toBeGreaterThan(before);
      expect(sched!.lastRunAt).toBeGreaterThanOrEqual(before);
      expect(sched!.lastMissionId).toBeDefined();

      const missions = await ctx.db.query("missions").collect();
      expect(missions[0].status).toBe("todo");
      expect(missions[0].ownerId).toBe(OWNER_ID);
    });
  });

  it("never fires a paused schedule", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await seedSchedule(t, { status: "paused" });

    await t.action(internal.schedules.tick, {});

    expect(await missionCount(t)).toBe(0);
  });

  it("does not fire a schedule whose nextRunAt is still in the future", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await seedSchedule(t, { nextRunAt: Date.now() + 60_000 });

    await t.action(internal.schedules.tick, {});

    expect(await missionCount(t)).toBe(0);
  });

  it("a failing schedule does not interrupt the others in the same tick", async () => {
    const t = convexTest(schema, modules);
    // Healthy schedule: active agent for TEMPLATE_ID.
    await seedActiveAgent(t);
    const healthy = await seedSchedule(t);
    // Broken schedule: targets a template with no active projectAgent, so
    // createForOwner -> dispatchRun throws.
    await seedSchedule(t, { templateId: "no-agent" });

    await t.action(internal.schedules.tick, {});

    // The healthy schedule still produced its Mission and advanced.
    expect(await missionCount(t)).toBe(1);
    await t.run(async (ctx) => {
      const sched = await ctx.db.get(healthy);
      expect(sched!.lastMissionId).toBeDefined();
    });
  });

  it("scheduled mission does NOT receive the manual type#number default name", async () => {
    // The schedule tick passes no `name` to createForOwner; missions created
    // this way should have no name field (undefined), not the "${type} #${N}"
    // default that the manual `create` handler derives for UI-submitted missions.
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await seedSchedule(t, { type: "create_article" });

    await t.action(internal.schedules.tick, {});

    await t.run(async (ctx) => {
      const missions = await ctx.db.query("missions").collect();
      expect(missions).toHaveLength(1);
      // name must be absent — not the manual default "create_article #1".
      expect(missions[0].name).toBeUndefined();
    });
  });

  it("copies schedule.autoPublish:true onto the created Mission (issue #330)", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await seedSchedule(t, { autoPublish: true });

    await t.action(internal.schedules.tick, {});

    await t.run(async (ctx) => {
      const missions = await ctx.db.query("missions").collect();
      expect(missions).toHaveLength(1);
      expect(missions[0].autoPublish).toBe(true);
    });
  });

  it("leaves the created Mission's autoPublish undefined when the schedule has none set", async () => {
    const t = convexTest(schema, modules);
    await seedActiveAgent(t);
    await seedSchedule(t);

    await t.action(internal.schedules.tick, {});

    await t.run(async (ctx) => {
      const missions = await ctx.db.query("missions").collect();
      expect(missions).toHaveLength(1);
      expect(missions[0].autoPublish).toBeUndefined();
    });
  });
});
