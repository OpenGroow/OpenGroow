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
};

const INSTANCE_ID = "openclaw-instance-backfill";
const TEMPLATE_ID = "@opengroow/video-demo";
const OPENCLAW_AGENT = "video-demo";
const OWNER_ID = "owner-backfill";

async function seedMissionAndRun(
  t: ReturnType<typeof convexTest>,
  opts: {
    status: "awaiting_job" | "completed";
    mcpJob?: {
      serverName: string;
      jobId: string;
      summary: string;
      reviewQuestions: string[];
      jobType?: string;
      missionType?: string;
    };
  },
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_video",
      payload: {},
      status: "doing",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: OPENCLAW_AGENT,
      sessionKey: "mega-run-backfill",
      status: opts.status,
      ...(opts.mcpJob !== undefined ? { mcpJob: opts.mcpJob } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

describe("backfillLegacyMcpJobType", () => {
  it("patches a legacy awaiting_job Run whose mcpJob is missing jobType to the 'legacy' sentinel", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedMissionAndRun(t, {
      status: "awaiting_job",
      mcpJob: {
        serverName: "video-mcp",
        jobId: "render-legacy-1",
        summary: "Rendering…",
        reviewQuestions: [],
        // no jobType — this is the pre-#243 shape.
      },
    });

    const result = await t.mutation(internal.runs.backfillLegacyMcpJobType, {});
    expect(result).toEqual({ patched: 1 });

    const run = await t.run(async (ctx) => ctx.db.get(runId));
    expect(run?.mcpJob?.jobType).toBe("legacy");
  });

  it("leaves an already-populated mcpJob.jobType untouched", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedMissionAndRun(t, {
      status: "awaiting_job",
      mcpJob: {
        serverName: "video-mcp",
        jobId: "render-2",
        summary: "Rendering…",
        reviewQuestions: [],
        jobType: "produce_video",
      },
    });

    const result = await t.mutation(internal.runs.backfillLegacyMcpJobType, {});
    expect(result).toEqual({ patched: 0 });

    const run = await t.run(async (ctx) => ctx.db.get(runId));
    expect(run?.mcpJob?.jobType).toBe("produce_video");
  });

  it("ignores Runs that are not in awaiting_job status", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedMissionAndRun(t, { status: "completed" });

    const result = await t.mutation(internal.runs.backfillLegacyMcpJobType, {});
    expect(result).toEqual({ patched: 0 });

    const run = await t.run(async (ctx) => ctx.db.get(runId));
    expect(run?.mcpJob).toBeUndefined();
  });
});
