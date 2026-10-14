// External human-review blocker (issue #323): a Run can terminate with a
// `blocked_external` RunResult when a human must act on an MCP server's own
// dashboard before the Mission can proceed — not a failure, not something
// OpenGroow's own review page can resolve. This file covers the two Convex
// seams described in the issue: the markCompleted dispatcher mapping
// `blocked_external` -> Mission status `blocked`, and retryMission accepting
// `blocked` missions in addition to `failed` ones.
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

const INSTANCE_ID = "openclaw-instance-blocked";
const TEMPLATE_ID = "@opengroow/seo";
const OPENCLAW_AGENT = "seo";
const OWNER_ID = "owner-blocked";

const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  tokenIdentifier: "test|owner-blocked",
  subject: OWNER_ID,
};

const BLOCKED_EXTERNAL_RESULT = {
  status: "blocked_external" as const,
  summary: "Waiting on the keyword batch to be validated on article-mcp's dashboard",
  blockerCode: "keyword_batch_pending",
  message: "Your first keyword batch needs human review before OpenGroow can proceed.",
  resolution: { kind: "link" as const, url: "https://article-mcp.example.com/projects/abc/keywords/review" },
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
      workspaceKey: "ws-blocked",
      openclawAgentName: OPENCLAW_AGENT,
      mcpServerKeys: [],
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("markCompleted — blocked_external dispatch", () => {
  it("transitions the Mission to status blocked and stores lastResult", async () => {
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
        sessionKey: "mega-run-blocked-1",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.runs.markCompleted, {
      runId,
      result: BLOCKED_EXTERNAL_RESULT,
    });

    await t.run(async (ctx) => {
      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("blocked");
      expect(mission?.lastResult).toMatchObject(BLOCKED_EXTERNAL_RESULT);
    });
  });
});

describe("missions.retryMission — blocked missions", () => {
  async function seedBlockedMissionWithRun(
    t: ReturnType<typeof convexTest>,
  ): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
    return t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "retry" },
        status: "blocked",
        lastResult: BLOCKED_EXTERNAL_RESULT,
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: "mega-run-blocked-seed",
        status: "completed",
        result: BLOCKED_EXTERNAL_RESULT,
        createdAt: now,
        updatedAt: now,
      });
      return { missionId, runId };
    });
  }

  it("does not throw and transitions a blocked mission back to doing", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedActiveAgent(t);
    const { missionId, runId: sourceRunId } = await seedBlockedMissionWithRun(t);

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
    });
  });
});
