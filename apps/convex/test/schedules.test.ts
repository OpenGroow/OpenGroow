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
  "../schedules.ts": () => import("../schedules.js"),
};

const INSTANCE_ID = "openclaw-instance-sched-1";
const TEMPLATE_ID = "@opengroow/seo";

const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-1", subject: "owner-1" };
const STRANGER = { name: "Stranger", email: "s@example.com", tokenIdentifier: "test|stranger", subject: "stranger" };

async function seedInstance(t: ReturnType<typeof convexTest>, userId = OWNER.subject) {
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
      userId,
    });
  });
}

const DAILY = { unit: "daily" as const, hour: 9, minute: 0 };

describe("schedules.create", () => {
  it("rejects when caller is not the instance owner", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, OWNER.subject);

    await expect(
      t.withIdentity(STRANGER).mutation(api.schedules.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "x" },
        frequency: DAILY,
        timezone: "Europe/Paris",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("creates an active schedule with a strictly-future nextRunAt", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const before = Date.now();
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
      frequency: DAILY,
      timezone: "Europe/Paris",
    });

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.status).toBe("active");
      expect(sched!.ownerId).toBe(OWNER.subject);
      expect(sched!.type).toBe("create_article");
      expect(sched!.payload).toEqual({ keyword: "octopus" });
      expect(sched!.unit).toBe("daily");
      expect(sched!.hour).toBe(9);
      expect(sched!.timezone).toBe("Europe/Paris");
      expect(sched!.nextRunAt).toBeGreaterThan(before);
    });
  });

  it("persists autoPublish:true when passed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
      frequency: DAILY,
      timezone: "Europe/Paris",
      autoPublish: true,
    });

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.autoPublish).toBe(true);
    });
  });

  it("leaves autoPublish undefined when not passed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
      frequency: DAILY,
      timezone: "Europe/Paris",
    });

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.autoPublish).toBeUndefined();
    });
  });

  it("persists the day field and a future nextRunAt for weekly and monthly", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    const before = Date.now();
    const weekly = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      frequency: { unit: "weekly", dayOfWeek: 1, hour: 9, minute: 0 },
      timezone: "Europe/Paris",
    });
    const monthly = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      frequency: { unit: "monthly", dayOfMonth: 15, hour: 9, minute: 0 },
      timezone: "Europe/Paris",
    });

    await t.run(async (ctx) => {
      const w = await ctx.db.get(weekly.scheduleId);
      expect(w!.unit).toBe("weekly");
      expect(w!.dayOfWeek).toBe(1);
      expect(w!.dayOfMonth).toBeUndefined();
      expect(w!.nextRunAt).toBeGreaterThan(before);

      const m = await ctx.db.get(monthly.scheduleId);
      expect(m!.unit).toBe("monthly");
      expect(m!.dayOfMonth).toBe(15);
      expect(m!.dayOfWeek).toBeUndefined();
      expect(m!.nextRunAt).toBeGreaterThan(before);
    });
  });
});

describe("schedules.pause", () => {
  it("rejects a non-owner caller", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      frequency: DAILY,
      timezone: "Europe/Paris",
    });

    await expect(
      t.withIdentity(STRANGER).mutation(api.schedules.pause, { scheduleId }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("sets the schedule status to paused", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      frequency: DAILY,
      timezone: "Europe/Paris",
    });

    await t.withIdentity(OWNER).mutation(api.schedules.pause, { scheduleId });

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.status).toBe("paused");
    });
  });
});

describe("schedules.resume", () => {
  it("rejects a non-owner caller", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article",
      payload: {}, frequency: DAILY, timezone: "Europe/Paris",
    });
    await t.withIdentity(OWNER).mutation(api.schedules.pause, { scheduleId });

    await expect(
      t.withIdentity(STRANGER).mutation(api.schedules.resume, { scheduleId }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("sets status to active and recalculates nextRunAt strictly in the future", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const before = Date.now();
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article",
      payload: {}, frequency: DAILY, timezone: "Europe/Paris",
    });
    await t.withIdentity(OWNER).mutation(api.schedules.pause, { scheduleId });

    await t.withIdentity(OWNER).mutation(api.schedules.resume, { scheduleId });

    await t.run(async (ctx) => {
      const sched = await ctx.db.get(scheduleId);
      expect(sched!.status).toBe("active");
      expect(sched!.nextRunAt).toBeGreaterThan(before);
    });
  });
});

describe("schedules.remove", () => {
  it("rejects a non-owner caller", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article",
      payload: {}, frequency: DAILY, timezone: "Europe/Paris",
    });

    await expect(
      t.withIdentity(STRANGER).mutation(api.schedules.remove, { scheduleId }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("deletes the schedule document", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article",
      payload: {}, frequency: DAILY, timezone: "Europe/Paris",
    });

    await t.withIdentity(OWNER).mutation(api.schedules.remove, { scheduleId });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(scheduleId)).toBeNull();
    });
  });

  it("does not delete existing missions when the schedule is removed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const { scheduleId } = await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "create_article",
      payload: {}, frequency: DAILY, timezone: "Europe/Paris",
    });
    // Seed a mission linked to this schedule.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.withIdentity(OWNER).mutation(api.schedules.remove, { scheduleId });

    await t.run(async (ctx) => {
      const missions = await ctx.db.query("missions").collect();
      expect(missions).toHaveLength(1);
    });
  });
});

describe("schedules.listByInstance", () => {
  it("returns only the calling owner's schedules on the instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, OWNER.subject);

    await t.withIdentity(OWNER).mutation(api.schedules.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      frequency: DAILY,
      timezone: "Europe/Paris",
    });

    // A schedule owned by someone else on the same instance (seeded directly).
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("schedules", {
        ownerId: STRANGER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        unit: "daily",
        hour: 9,
        minute: 0,
        timezone: "Europe/Paris",
        status: "active",
        nextRunAt: now + 1000,
        createdAt: now,
        updatedAt: now,
      });
    });

    const mine = await t.withIdentity(OWNER).query(api.schedules.listByInstance, {
      instanceId: INSTANCE_ID,
    });
    expect(mine).toHaveLength(1);
    expect(mine[0].ownerId).toBe(OWNER.subject);
  });
});
