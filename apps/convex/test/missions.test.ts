import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
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

const INSTANCE_ID = "openclaw-instance-mission-1";
const TEMPLATE_ID = "@opengroow/seo";
const OPENCLAW_AGENT = "seo";

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

async function seedActiveAgent(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{ status: "active" | "inactive" | "activating" | "error"; openclawAgentName?: string }> = {},
) {
  const status = overrides.status ?? "active";
  const openclawAgentName = "openclawAgentName" in overrides ? overrides.openclawAgentName : OPENCLAW_AGENT;
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status,
      workspaceKey: "ws-test",
      openclawAgentName,
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedMissionToValidate(
  t: ReturnType<typeof convexTest>,
  status: "to_validate" | "doing" = "to_validate",
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    return ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "seo_article",
      payload: {},
        name: "Test Mission",
      status,
      lastResult: {
        status: "needs_human_review",
        summary: "Article ready for review",
        reviewQuestions: ["Does it match the keyword?"],
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("missions.create", () => {
  it("rejects when not authenticated", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    await expect(
      t.mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "x" },
        name: "Test Mission",
      }),
    ).rejects.toThrow(/Authentication/);
  });

  it("rejects when caller is not the instance owner", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, OWNER.subject);
    await seedActiveAgent(t);

    await expect(
      t.withIdentity(STRANGER).mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "x" },
        name: "Test Mission",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("rejects when projectAgents row is missing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
      }),
    ).rejects.toThrow(/not active|inactive|active/i);
  });

  it("rejects when projectAgents.status is not active", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t, { status: "inactive" });

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
      }),
    ).rejects.toThrow(/not active|active/i);
  });

  it("rejects when openclawAgentName is missing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t, { openclawAgentName: undefined });

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
      }),
    ).rejects.toThrow(/openclawAgentName|agent name/i);
  });

  it("inserts mission(todo)+run(pending) atomically with ownerId snapshot", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    const { missionId, runId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "relationship conflict" },
      name: "Test Mission",
    });

    expect(missionId).toBeTypeOf("string");
    expect(runId).toBeTypeOf("string");

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission).not.toBeNull();
      expect(mission!.status).toBe("todo");
      expect(mission!.ownerId).toBe(OWNER.subject);
      expect(mission!.instanceId).toBe(INSTANCE_ID);
      expect(mission!.templateId).toBe(TEMPLATE_ID);
      expect(mission!.type).toBe("create_article");
      expect(mission!.payload).toEqual({ keyword: "relationship conflict" });

      const run = await ctx.db.get(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe("pending");
      expect(run!.ownerId).toBe(OWNER.subject);
      expect(run!.missionId).toBe(missionId);
      expect(run!.instanceId).toBe(INSTANCE_ID);
      expect(run!.templateId).toBe(TEMPLATE_ID);
      expect(run!.agentName).toBe(OPENCLAW_AGENT);
      expect(run!.sessionKey).toBe(`mega-run-${runId}`);
    });
  });

  it("persists autoPublish:true when passed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
      name: "Test Mission",
      autoPublish: true,
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.autoPublish).toBe(true);
    });
  });

  it("leaves autoPublish undefined when not passed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    const { missionId } = await t.withIdentity(OWNER).mutation(api.missions.create, {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
      name: "Test Mission",
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.autoPublish).toBeUndefined();
    });
  });
});

describe("missions.setAutoPublish", () => {
  async function seedMissionWithStatus(
    t: ReturnType<typeof convexTest>,
    status: "todo" | "doing" | "to_validate" | "approved" | "done" | "failed" | "blocked",
  ) {
    const now = Date.now();
    return t.run(async (ctx) => {
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
        status,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it("sets autoPublish to true while status is todo", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "todo");

    await t.withIdentity(OWNER).mutation(api.missions.setAutoPublish, {
      missionId,
      autoPublish: true,
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.autoPublish).toBe(true);
    });
  });

  it("toggles autoPublish back to false while status is doing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "doing");
    await t.run(async (ctx) => {
      await ctx.db.patch(missionId, { autoPublish: true });
    });

    await t.withIdentity(OWNER).mutation(api.missions.setAutoPublish, {
      missionId,
      autoPublish: false,
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.autoPublish).toBe(false);
    });
  });

  it("rejects when status is to_validate", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "to_validate");

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.setAutoPublish, { missionId, autoPublish: true }),
    ).rejects.toThrow(/todo.*doing/);
  });

  it("rejects when status is done", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "done");

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.setAutoPublish, { missionId, autoPublish: true }),
    ).rejects.toThrow(/todo.*doing/);
  });

  it("rejects for a non-owner", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "todo");

    await expect(
      t.withIdentity(STRANGER).mutation(api.missions.setAutoPublish, { missionId, autoPublish: true }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("rejects when the mission does not exist", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionWithStatus(t, "todo");
    await t.run(async (ctx) => {
      await ctx.db.delete(missionId);
    });

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.setAutoPublish, { missionId, autoPublish: true }),
    ).rejects.toThrow(/Mission not found/);
  });
});

describe("missions.createForOwner (internal)", () => {
  it("creates mission(todo)+run(pending) from an ownerId without an auth identity", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    const { missionId, runId } = await t.mutation(internal.missions.createForOwner, {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "octopus" },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.status).toBe("todo");
      expect(mission!.ownerId).toBe(OWNER.subject);
      expect(mission!.type).toBe("create_article");
      expect(mission!.payload).toEqual({ keyword: "octopus" });

      const run = await ctx.db.get(runId);
      expect(run!.status).toBe("pending");
      expect(run!.ownerId).toBe(OWNER.subject);
      expect(run!.missionId).toBe(missionId);
      expect(run!.agentName).toBe(OPENCLAW_AGENT);
    });
  });
});

// An Intermediate External Job (ADR-026) completed: the poll engine's
// `markResumed` decision is applied by writing the Intermediate Result onto
// the Mission and creating a new `pending` Run for the same Mission — the
// Mission's own status is left untouched (no terminal RunResult).
describe("missions.resumeMission (internal, ADR-026)", () => {
  it("writes lastIntermediateResult, creates a pending Run for the same Mission, and leaves Mission status untouched", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const missionId = await seedMissionToValidate(t, "doing");

    const { runId } = await t.mutation(internal.missions.resumeMission, {
      missionId,
      intermediateResult: {
        jobType: "plan_article",
        output: { articlePlan: { steps: ["outline", "draft"] } },
      },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.status).toBe("doing");
      expect(mission!.lastIntermediateResult).toEqual({
        jobType: "plan_article",
        output: { articlePlan: { steps: ["outline", "draft"] } },
      });

      // `runId` is null only when the Mission was cancelled (issue #482);
      // this Mission is `doing`, so a Run must have been dispatched.
      const run = await ctx.db.get(runId!);
      expect(run!.status).toBe("pending");
      expect(run!.missionId).toBe(missionId);
      expect(run!.ownerId).toBe(mission!.ownerId);
    });
  });

  it("replaces (never accumulates) a previous lastIntermediateResult", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const missionId = await seedMissionToValidate(t, "doing");

    await t.mutation(internal.missions.resumeMission, {
      missionId,
      intermediateResult: { jobType: "plan_article", output: { articlePlan: { revision: 1 } } },
    });
    await t.mutation(internal.missions.resumeMission, {
      missionId,
      intermediateResult: { jobType: "plan_article", output: { articlePlan: { revision: 2 } } },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.lastIntermediateResult).toEqual({
        jobType: "plan_article",
        output: { articlePlan: { revision: 2 } },
      });
    });
  });
});

// resumeMissionAfterRetryableFailure extends ADR-026's "resume with an
// Intermediate Result" mechanism to a retryable External Job failure
// (`onFail: "resume_mission"`, e.g. the Letter service rejecting an
// over-length title): a new pending Run is dispatched for the same Mission,
// the error is written to `lastRetryableFailure` (distinct from
// lastIntermediateResult, which carries a non-terminal success value), and
// `retryableFailureCount` is incremented so decideExternalJobPoll can cap the
// retry loop.
describe("missions.resumeMissionAfterRetryableFailure (internal)", () => {
  it("writes lastRetryableFailure, increments retryableFailureCount, creates a pending Run, and leaves Mission status untouched", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const missionId = await seedMissionToValidate(t, "doing");

    const { runId } = await t.mutation(internal.missions.resumeMissionAfterRetryableFailure, {
      missionId,
      jobType: "produce_video",
      error: "Letter service failed: 400 Bad Request — title too long",
      details: { runId: "render-1", status: "failed", failedStep: "generateLetter" },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.status).toBe("doing");
      expect(mission!.retryableFailureCount).toBe(1);
      expect(mission!.lastRetryableFailure).toEqual({
        jobType: "produce_video",
        error: "Letter service failed: 400 Bad Request — title too long",
        details: { runId: "render-1", status: "failed", failedStep: "generateLetter" },
      });

      // See resumeMission above: null only for a cancelled Mission (#482).
      const run = await ctx.db.get(runId!);
      expect(run!.status).toBe("pending");
      expect(run!.missionId).toBe(missionId);
    });
  });

  it("increments retryableFailureCount on each successive call instead of resetting it", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const missionId = await seedMissionToValidate(t, "doing");

    await t.mutation(internal.missions.resumeMissionAfterRetryableFailure, {
      missionId,
      jobType: "produce_video",
      error: "attempt 1",
    });
    await t.mutation(internal.missions.resumeMissionAfterRetryableFailure, {
      missionId,
      jobType: "produce_video",
      error: "attempt 2",
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission!.retryableFailureCount).toBe(2);
      expect(mission!.lastRetryableFailure!.error).toBe("attempt 2");
    });
  });
});

describe("missions.markFailed (internal, issue #329)", () => {
  it("transitions to_validate -> failed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionToValidate(t, "to_validate");

    await t.mutation(internal.missions.markFailed, { missionId, errorMessage: "approve step failed" });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("failed");
    expect(mission?.errorMessage).toBe("approve step failed");
  });

  it("does not regress an already-done Mission (concurrent human completion race)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionToValidate(t, "to_validate");
    await t.run(async (ctx) => ctx.db.patch(missionId, { status: "done" }));

    await t.mutation(internal.missions.markFailed, { missionId, errorMessage: "stale approve step failed" });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("done");
    expect(mission?.errorMessage).toBeUndefined();
  });

  it("does not regress an already-failed Mission", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const missionId = await seedMissionToValidate(t, "to_validate");
    await t.run(async (ctx) => ctx.db.patch(missionId, { status: "failed", errorMessage: "first failure" }));

    await t.mutation(internal.missions.markFailed, { missionId, errorMessage: "stale publish step failed" });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.errorMessage).toBe("first failure");
  });
});
