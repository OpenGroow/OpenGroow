import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
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
};

const INSTANCE_ID = "openclaw-instance-retry";
const TEMPLATE_ID = "@opengroow/seo";
const OPENCLAW_AGENT = "seo";
const OWNER_ID = "owner-retry";

const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  tokenIdentifier: "test|owner-retry",
  subject: OWNER_ID,
};

const ARTIFACT = {
  external: { service: "article-mcp", id: "article-42" },
  metadata: { title: "My Article" },
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
      userId: OWNER_ID,
    });
  });
}

async function seedActiveAgent(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      workspaceKey: "ws-retry",
      openclawAgentName: OPENCLAW_AGENT,
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedFailedMissionWithRun(
  t: ReturnType<typeof convexTest>,
  opts: { humanFeedback?: string; lastArtifact?: typeof ARTIFACT } = {},
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: { keyword: "retry" },
      status: "failed",
      lastResult: {
        status: "failed",
        summary: "Something went wrong",
        error: { code: "runtime", message: "boom" },
      },
      ...(opts.lastArtifact !== undefined ? { lastArtifact: opts.lastArtifact } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: OPENCLAW_AGENT,
      sessionKey: `mega-run-seed`,
      status: "failed",
      ...(opts.humanFeedback !== undefined ? { humanFeedback: opts.humanFeedback } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

// ---------------------------------------------------------------------------
// lastArtifact preservation via markCompleted
// ---------------------------------------------------------------------------
describe("lastArtifact preservation in markCompleted", () => {
  it("writes lastArtifact when result is needs_human_review with artifact", async () => {
    const t = convexTest(schema, modules);
    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
    });
    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: "mega-run-test1",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: {
        status: "needs_human_review",
        summary: "Ready for review",
        reviewQuestions: ["Looks good?"],
        artifact: ARTIFACT,
      },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("to_validate");
      expect(mission?.lastArtifact).toMatchObject(ARTIFACT);
    });
  });

  it("writes lastArtifact when result is success with artifact", async () => {
    const t = convexTest(schema, modules);
    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
    });
    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: "mega-run-test2",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: {
        status: "success",
        summary: "Done",
        artifact: ARTIFACT,
      },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("done");
      expect(mission?.lastArtifact).toMatchObject(ARTIFACT);
    });
  });

  it("does NOT overwrite lastArtifact when result is failed", async () => {
    const t = convexTest(schema, modules);
    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        lastArtifact: ARTIFACT,
        createdAt: now,
        updatedAt: now,
      });
    });
    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: "mega-run-test3",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: {
        status: "failed",
        summary: "Something went wrong",
        error: { code: "runtime", message: "boom" },
      },
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("failed");
      // lastArtifact must be preserved — not cleared by a failed run
      expect(mission?.lastArtifact).toMatchObject(ARTIFACT);
    });
  });
});

// ---------------------------------------------------------------------------
// buildMissionContext — ## Last Artifact section
// ---------------------------------------------------------------------------
describe("buildMissionContext — Last Artifact section", () => {
  it("includes ## Last Artifact when lastResult is failed and lastArtifact exists", async () => {
    const { buildMissionContext } = await import("../mission_dispatcher/mission_context.js");
    const missionId = "test-mission-id" as Id<"missions">;
    const runId = "test-run-id" as Id<"runs">;

    const { contextMd } = buildMissionContext(
      {
        _id: missionId,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        lastResult: {
          status: "failed",
          summary: "Revision failed",
          error: { code: "runtime", message: "boom" },
        },
        lastArtifact: ARTIFACT,
      },
      { _id: runId, missionId, agentName: OPENCLAW_AGENT },
    );

    expect(contextMd).toContain("## Last Artifact");
    expect(contextMd).toContain('"service": "article-mcp"');
    expect(contextMd).toContain('"id": "article-42"');
  });

  it("does NOT include ## Last Artifact when lastResult is not failed", async () => {
    const { buildMissionContext } = await import("../mission_dispatcher/mission_context.js");
    const missionId = "test-mission-id2" as Id<"missions">;
    const runId = "test-run-id2" as Id<"runs">;

    const { contextMd } = buildMissionContext(
      {
        _id: missionId,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        lastResult: {
          status: "needs_human_review",
          summary: "Ready",
          reviewQuestions: [],
        },
        lastArtifact: ARTIFACT,
      },
      { _id: runId, missionId, agentName: OPENCLAW_AGENT },
    );

    expect(contextMd).not.toContain("## Last Artifact");
  });

  it("does NOT include ## Last Artifact when lastResult is failed but lastArtifact is absent", async () => {
    const { buildMissionContext } = await import("../mission_dispatcher/mission_context.js");
    const missionId = "test-mission-id3" as Id<"missions">;
    const runId = "test-run-id3" as Id<"runs">;

    const { contextMd } = buildMissionContext(
      {
        _id: missionId,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        lastResult: {
          status: "failed",
          summary: "No artifact here",
          error: { code: "runtime", message: "boom" },
        },
      },
      { _id: runId, missionId, agentName: OPENCLAW_AGENT },
    );

    expect(contextMd).not.toContain("## Last Artifact");
  });
});

// ---------------------------------------------------------------------------
// retryMission mutation
// ---------------------------------------------------------------------------
describe("missions.retryMission", () => {
  it("throws when mission status is not failed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);

    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
    });
    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: "mega-run-guard",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(OWNER).mutation(api.missions.retryMission, { missionId, sourceRunId: runId }),
    ).rejects.toThrow(/not failed/i);
  });

  it("throws when caller is not the instance owner", async () => {
    const STRANGER = {
      name: "Stranger",
      email: "s@example.com",
      tokenIdentifier: "test|stranger-retry",
      subject: "stranger-retry",
    };
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const { missionId, runId } = await seedFailedMissionWithRun(t);

    await expect(
      t.withIdentity(STRANGER).mutation(api.missions.retryMission, { missionId, sourceRunId: runId }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("creates a new run and transitions mission to doing (no humanFeedback)", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const { missionId, runId: sourceRunId } = await seedFailedMissionWithRun(t);

    const result = await t.withIdentity(OWNER).mutation(api.missions.retryMission, {
      missionId,
      sourceRunId,
    });

    expect(result.runId).toBeTypeOf("string");

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("doing");

      const newRun = await ctx.db.get(result.runId);
      expect(newRun?.status).toBe("pending");
      expect(newRun?.missionId).toBe(missionId);
      expect(newRun?.humanFeedback).toBeUndefined();
    });
  });

  it("inherits humanFeedback from sourceRunId when present", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const { missionId, runId: sourceRunId } = await seedFailedMissionWithRun(t, {
      humanFeedback: "Please fix the introduction paragraph.",
    });

    const result = await t.withIdentity(OWNER).mutation(api.missions.retryMission, {
      missionId,
      sourceRunId,
    });

    await t.run(async (ctx) => {
      const newRun = await ctx.db.get(result.runId);
      expect(newRun?.humanFeedback).toBe("Please fix the introduction paragraph.");
    });
  });

  it("passes humanFeedback=undefined when sourceRun has none", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const { missionId, runId: sourceRunId } = await seedFailedMissionWithRun(t);
    // sourceRunId has no humanFeedback

    const result = await t.withIdentity(OWNER).mutation(api.missions.retryMission, {
      missionId,
      sourceRunId,
    });

    await t.run(async (ctx) => {
      const newRun = await ctx.db.get(result.runId);
      expect(newRun?.humanFeedback).toBeUndefined();
    });
  });
});
