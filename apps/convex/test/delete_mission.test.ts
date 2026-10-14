import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-delete-mission-1";
const TEMPLATE_ID = "article";

const OWNER = {
  name: "Owner",
  email: "o@e.com",
  tokenIdentifier: "test|delete-mission-owner",
  subject: "owner-delete-mission",
};

const OTHER = {
  name: "Other",
  email: "x@e.com",
  tokenIdentifier: "test|delete-mission-other",
  subject: "other-delete-mission",
};

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
      userId: OWNER.subject,
    });
  });
}

async function seedMission(
  t: ReturnType<typeof convexTest>,
  status: "todo" | "doing" | "to_validate" | "approved" | "done" | "failed" = "todo",
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedRuns(
  t: ReturnType<typeof convexTest>,
  missionId: Awaited<ReturnType<typeof seedMission>>,
  count = 2,
  status: "pending" | "dispatching" | "running" | "completed" | "failed" = "completed",
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: "article-agent",
        sessionKey: `mega-run-session-${i}`,
        status,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

describe("missions.deleteMission", () => {
  it("throws when not authenticated", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);

    await expect(
      t.mutation(api.missions.deleteMission, { missionId }),
    ).rejects.toThrow(/Authentication/i);
  });

  it("throws Forbidden when a different user tries to delete", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t);

    await expect(
      t.withIdentity(OTHER).mutation(api.missions.deleteMission, { missionId }),
    ).rejects.toThrow(/Forbidden/i);

    // Mission still exists
    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).not.toBeNull();
    });
  });

  it("throws when mission does not exist", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    // Insert then delete to get a valid-format but missing id
    const missionId = await seedMission(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(missionId);
    });

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId }),
    ).rejects.toThrow(/Mission not found/i);
  });

  it("throws when the mission is doing (a Run is running on the Instance)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "doing");
    await seedRuns(t, missionId, 1, "running");

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId }),
    ).rejects.toThrow(/in flight/i);

    // Mission still exists
    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).not.toBeNull();
    });
  });

  it("throws when a todo mission has a Run mid-dispatch (dispatching)", async () => {
    // The window cubic flagged: the dispatcher has claimed the Run (pending →
    // dispatching) and is enqueuing exec commands to the Instance, but the
    // mission has not flipped to `doing` yet. Deleting now would orphan the
    // dispatch, so the guard must refuse based on the Run, not the status.
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "todo");
    await seedRuns(t, missionId, 1, "dispatching");

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId }),
    ).rejects.toThrow(/in flight/i);

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).not.toBeNull();
    });
  });

  it("deletes a todo mission stuck with only a pending Run (not yet on the Instance)", async () => {
    // A pending Run was never claimed by the dispatcher — nothing is live on the
    // Instance. The user must be able to clear such a stuck mission; the cascade
    // removes the queued Run too, so the dispatcher never sees an orphan.
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "todo");
    await seedRuns(t, missionId, 1, "pending");

    await t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(missionId)).toBeNull();
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(0);
    });
  });

  it("deletes the mission and cascades to all its runs", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "failed");
    await seedRuns(t, missionId, 3);

    // Verify runs exist before delete
    await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(3);
    });

    await t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId });

    // Mission is gone
    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).toBeNull();
    });

    // Runs are gone
    await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(0);
    });
  });

  it("deletes a mission with no runs", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "failed");

    await t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).toBeNull();
    });
  });

  it("deletes a done mission and cascades to its runs", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "done");
    await seedRuns(t, missionId, 1);

    await t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).toBeNull();
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      expect(runs).toHaveLength(0);
    });
  });

  it("does not touch commands, events, or projectCounters", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMission(t, "todo");

    // Insert a projectCounter, an event, and a command scoped to the same
    // instance so we can verify none of them are touched by deleteMission.
    const now = Date.now();
    let commandId: Id<"commands">;
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCounters", { instanceId: INSTANCE_ID, missionCount: 5 });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: "evt-1",
        type: "SomeEvent",
        payload: {},
        ts: now,
        createdAt: now,
      });
      commandId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "SomeCommand",
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
    });

    await t.withIdentity(OWNER).mutation(api.missions.deleteMission, { missionId });

    await t.run(async (ctx) => {
      const counter = await ctx.db
        .query("projectCounters")
        .withIndex("by_instance", (q) => q.eq("instanceId", INSTANCE_ID))
        .unique();
      expect(counter?.missionCount).toBe(5);

      const events = await ctx.db
        .query("events")
        .withIndex("by_instance_created", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect();
      expect(events).toHaveLength(1);

      // Acceptance criterion 3: commands are untouched.
      const command = await ctx.db.get(commandId!);
      expect(command).not.toBeNull();
    });
  });
});
