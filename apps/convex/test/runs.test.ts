import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

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

const INSTANCE_A = "openclaw-instance-A";
const INSTANCE_B = "openclaw-instance-B";

useTemplateRegistry([INSTANCE_A, INSTANCE_B], ["@opengroow/engagement"]);
const TEMPLATE_ID = "@opengroow/seo";
const OWNER_ID = "owner-1";

async function seedMissionAndRun(
  t: ReturnType<typeof convexTest>,
  opts: {
    instanceId: string;
    templateId?: string;
    missionType?: string;
    ownerId?: string;
    runStatus: "pending" | "dispatching" | "running" | "awaiting_job" | "completed" | "failed" | "resumed";
    createdAt: number;
  },
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  return await t.run(async (ctx) => {
    const templateId = opts.templateId ?? TEMPLATE_ID;
    const missionId = await ctx.db.insert("missions", {
      ownerId: opts.ownerId ?? OWNER_ID,
      instanceId: opts.instanceId,
      templateId,
      type: opts.missionType ?? "create_article",
      payload: {},
      status: "todo",
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: opts.ownerId ?? OWNER_ID,
      instanceId: opts.instanceId,
      templateId,
      agentName: templateId,
      sessionKey: `mega-mission-${missionId}`,
      status: opts.runStatus,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });
    return { missionId, runId };
  });
}

describe("runs.claimNextPending", () => {
  it("returns null when no pending run exists", async () => {
    const t = convexTest(schema, modules);
    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed).toBeNull();
  });

  it("claims oldest pending run and transitions to dispatching with dispatchedAt", async () => {
    const t = convexTest(schema, modules);
    const newer = await seedMissionAndRun(t, { instanceId: INSTANCE_A, runStatus: "pending", createdAt: 2000 });
    const older = await seedMissionAndRun(t, { instanceId: INSTANCE_A, templateId: "other", runStatus: "pending", createdAt: 1000 });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed).not.toBeNull();
    expect(claimed!.runId).toBe(older.runId);

    await t.run(async (ctx) => {
      const olderDoc = await ctx.db.get(older.runId);
      expect(olderDoc?.status).toBe("dispatching");
      expect(olderDoc?.dispatchedAt).toBeTypeOf("number");

      const newerDoc = await ctx.db.get(newer.runId);
      expect(newerDoc?.status).toBe("pending");
    });
  });

  it("skips a pending run whose (instance,template) already has a dispatching run", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, { instanceId: INSTANCE_A, runStatus: "dispatching", createdAt: 1000 });
    const blockedPending = await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      runStatus: "pending",
      createdAt: 2000,
    });
    const otherInstance = await seedMissionAndRun(t, {
      instanceId: INSTANCE_B,
      runStatus: "pending",
      createdAt: 3000,
    });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed!.runId).toBe(otherInstance.runId);

    await t.run(async (ctx) => {
      const stillPending = await ctx.db.get(blockedPending.runId);
      expect(stillPending?.status).toBe("pending");
    });
  });

  it("skips a pending run whose (instance,template) already has a running run", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, { instanceId: INSTANCE_A, runStatus: "running", createdAt: 1000 });
    const blocked = await seedMissionAndRun(t, { instanceId: INSTANCE_A, runStatus: "pending", createdAt: 2000 });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed).toBeNull();

    await t.run(async (ctx) => {
      const stillPending = await ctx.db.get(blocked.runId);
      expect(stillPending?.status).toBe("pending");
    });
  });

  it("serializes pending Runs across different Agent Templates on the same device", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, { instanceId: INSTANCE_A, templateId: "@opengroow/engagement", runStatus: "running", createdAt: 1000 });
    const blocked = await seedMissionAndRun(t, { instanceId: INSTANCE_A, templateId: "@opengroow/seo", runStatus: "pending", createdAt: 2000 });
    const freeDevice = await seedMissionAndRun(t, { instanceId: INSTANCE_B, templateId: "@opengroow/seo", runStatus: "pending", createdAt: 3000 });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed?.runId).toBe(freeDevice.runId);

    await t.run(async (ctx) => {
      expect((await ctx.db.get(blocked.runId))?.status).toBe("pending");
    });
  });

  it("serializes Social Engagement `engage` Runs across instances sharing the paired Android node", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      templateId: "@opengroow/engagement",
      missionType: "engage",
      runStatus: "running",
      createdAt: 1000,
    });
    const blocked = await seedMissionAndRun(t, {
      instanceId: INSTANCE_B,
      templateId: "@opengroow/engagement",
      missionType: "engage",
      runStatus: "pending",
      createdAt: 2000,
    });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed).toBeNull();

    await t.run(async (ctx) => {
      expect((await ctx.db.get(blocked.runId))?.status).toBe("pending");
    });
  });

  it("does NOT serialize a non-engage social-engagement Mission type behind a running engage Run on another instance — it never touches the paired device", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      templateId: "@opengroow/engagement",
      missionType: "engage",
      runStatus: "running",
      createdAt: 1000,
    });
    const enrichRun = await seedMissionAndRun(t, {
      instanceId: INSTANCE_B,
      templateId: "@opengroow/engagement",
      missionType: "some-other-mission-type",
      runStatus: "pending",
      createdAt: 2000,
    });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed?.runId).toBe(enrichRun.runId);
  });

  it("does NOT serialize a pending engage Run behind a running non-engage social-engagement Run on another instance", async () => {
    const t = convexTest(schema, modules);
    await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      templateId: "@opengroow/engagement",
      missionType: "some-other-mission-type",
      runStatus: "running",
      createdAt: 1000,
    });
    const engageRun = await seedMissionAndRun(t, {
      instanceId: INSTANCE_B,
      templateId: "@opengroow/engagement",
      missionType: "engage",
      runStatus: "pending",
      createdAt: 2000,
    });

    const claimed = await t.mutation(internal.runs.claimNextPending, {});
    expect(claimed?.runId).toBe(engageRun.runId);
  });

  describe("declared exclusive resources (issue #656)", () => {
    const mt = (type: string) => ({ type, label: type, payload: "{}", agentsMd: `${type}.md` });
    const shooter = fixtureTemplate("shooter", {
      missionTypes: [mt("shoot"), mt("plan")],
      exclusiveResources: { camera: ["shoot"] },
    });
    const editor = fixtureTemplate("editor", {
      missionTypes: [mt("edit"), mt("review")],
      exclusiveResources: { camera: ["edit"] },
    });
    const plain = fixtureTemplate("plain", { missionTypes: [mt("work")] });
    useTemplateRegistry([INSTANCE_A, INSTANCE_B], [shooter, editor, plain]);

    it("serializes Runs of different Templates whose Mission types declare the same resource", async () => {
      const t = convexTest(schema, modules);
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_A, templateId: "shooter", missionType: "shoot", runStatus: "running", createdAt: 1000,
      });
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_B, templateId: "editor", missionType: "edit", runStatus: "pending", createdAt: 2000,
      });
      expect(await t.mutation(internal.runs.claimNextPending, {})).toBeNull();
    });

    it("claims only one of two pending Runs declaring the same resource", async () => {
      const t = convexTest(schema, modules);
      const first = await seedMissionAndRun(t, {
        instanceId: INSTANCE_A, templateId: "shooter", missionType: "shoot", runStatus: "pending", createdAt: 1000,
      });
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_B, templateId: "editor", missionType: "edit", runStatus: "pending", createdAt: 2000,
      });
      expect((await t.mutation(internal.runs.claimNextPending, {}))?.runId).toBe(first.runId);
      expect(await t.mutation(internal.runs.claimNextPending, {})).toBeNull();
    });

    it("does not serialize Runs of two different owners declaring the same resource", async () => {
      const t = convexTest(schema, modules);
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_A, ownerId: "owner-1", templateId: "shooter", missionType: "shoot", runStatus: "running", createdAt: 1000,
      });
      const otherOwner = await seedMissionAndRun(t, {
        instanceId: INSTANCE_B, ownerId: "owner-2", templateId: "editor", missionType: "edit", runStatus: "pending", createdAt: 2000,
      });
      expect((await t.mutation(internal.runs.claimNextPending, {}))?.runId).toBe(otherOwner.runId);
    });

    it("does not affect Mission types that do not declare the resource", async () => {
      const t = convexTest(schema, modules);
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_A, templateId: "shooter", missionType: "shoot", runStatus: "running", createdAt: 1000,
      });
      const review = await seedMissionAndRun(t, {
        instanceId: INSTANCE_B, templateId: "editor", missionType: "review", runStatus: "pending", createdAt: 2000,
      });
      expect((await t.mutation(internal.runs.claimNextPending, {}))?.runId).toBe(review.runId);
    });

    it("does not block a declaring Run behind an undeclaring one", async () => {
      const t = convexTest(schema, modules);
      await seedMissionAndRun(t, {
        instanceId: INSTANCE_A, templateId: "shooter", missionType: "plan", runStatus: "running", createdAt: 1000,
      });
      const shoot = await seedMissionAndRun(t, {
        instanceId: INSTANCE_B, templateId: "shooter", missionType: "shoot", runStatus: "pending", createdAt: 2000,
      });
      expect((await t.mutation(internal.runs.claimNextPending, {}))?.runId).toBe(shoot.runId);
    });
  });

  it("two concurrent calls never claim the same Run", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMissionAndRun(t, { instanceId: INSTANCE_A, runStatus: "pending", createdAt: 1000 });

    const [a, b] = await Promise.all([
      t.mutation(internal.runs.claimNextPending, {}),
      t.mutation(internal.runs.claimNextPending, {}),
    ]);

    const claimed = [a, b].filter((x) => x !== null);
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.runId).toBe(seeded.runId);
  });
});

// An Intermediate External Job (ADR-026) completed: this Run resolves to
// `resumed`, never `completed`/`failed` — it carries no RunResult and must
// never be re-polled or mistaken for a terminal result.
describe("runs.markResumed", () => {
  it("transitions an awaiting_job run to resumed without touching the Mission", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      runStatus: "awaiting_job",
      createdAt: 1000,
    });

    await t.mutation(internal.runs.markResumed, { runId });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("resumed");
      expect(run?.result).toBeUndefined();

      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("todo"); // unchanged — resumeMission owns the Mission write.
    });
  });

  it("rejects an illegal transition from a terminal status", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedMissionAndRun(t, {
      instanceId: INSTANCE_A,
      runStatus: "completed",
      createdAt: 1000,
    });

    await expect(t.mutation(internal.runs.markResumed, { runId })).rejects.toThrow(/illegal transition/);
  });
});
