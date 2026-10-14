import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { RunResult } from "../run_result";

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

const INSTANCE_ID = "openclaw-instance-trans";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER_ID = "owner-1";

type RunStatus = "pending" | "dispatching" | "running" | "completed" | "failed";

async function seed(
  t: ReturnType<typeof convexTest>,
  runStatus: RunStatus,
  patchRun: Record<string, unknown> = {},
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
      payload: {},
      status: runStatus === "pending" ? "todo" : "doing",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      agentName: TEMPLATE_ID,
      sessionKey: `mega-mission-${missionId}`,
      status: runStatus,
      createdAt: now,
      updatedAt: now,
      ...patchRun,
    });
    return { missionId, runId };
  });
}

describe("runs.markRunning", () => {
  it("transitions a dispatching run to running and patches dispatchCommandId", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "dispatching");
    const commandId = await t.run(async (ctx) =>
      ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "RUNTIME_OPENCLAW_EXEC",
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
      }),
    );

    await t.mutation(internal.runs.markRunning, { runId, dispatchCommandId: commandId });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("running");
      expect(run?.dispatchCommandId).toBe(commandId);
      const m = await ctx.db.get(missionId);
      expect(m?.status).toBe("doing");
    });
  });

  it("persists agentsMdSnapshot and contextMdSnapshot when provided (ADR-050)", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t, "dispatching");
    const commandId = await t.run(async (ctx) =>
      ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "RUNTIME_OPENCLAW_EXEC",
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
      }),
    );

    await t.mutation(internal.runs.markRunning, {
      runId,
      dispatchCommandId: commandId,
      agentsMdSnapshot: "# Agent instructions\n...",
      contextMdSnapshot: "# Brand Core\n...\n# Mission ...",
    });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.agentsMdSnapshot).toBe("# Agent instructions\n...");
      expect(run?.contextMdSnapshot).toBe("# Brand Core\n...\n# Mission ...");
    });
  });

  it("rejects markRunning from a non-dispatching status", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t, "pending");
    const commandId = await t.run(async (ctx) =>
      ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: "x",
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.runs.markRunning, { runId, dispatchCommandId: commandId }),
    ).rejects.toThrow(/illegal|transition|status/i);
  });
});

describe("runs.markCompleted", () => {
  const successResult: RunResult = { status: "success", summary: "ok" };
  const reviewResult: RunResult = {
    status: "needs_human_review",
    summary: "ask",
    reviewQuestions: ["q?"],
  };
  const failedResult: RunResult = {
    status: "failed",
    summary: "x",
    error: { code: "boom", message: "no" },
  };

  it("from running with success → mission status=done, lastResult set", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "running");
    await t.mutation(internal.runs.markCompleted, { runId, result: successResult });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("completed");
      expect(run?.result).toEqual(successResult);
      expect(run?.completedAt).toBeTypeOf("number");

      const mission = await ctx.db.get(missionId);
      expect(mission?.status).toBe("done");
      expect(mission?.lastResult).toEqual(successResult);
    });
  });

  it("from running with needs_human_review → mission status=to_validate", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "running");
    await t.mutation(internal.runs.markCompleted, { runId, result: reviewResult });

    await t.run(async (ctx) => {
      const m = await ctx.db.get(missionId);
      expect(m?.status).toBe("to_validate");
      expect(m?.lastResult).toEqual(reviewResult);
    });
  });

  it("from running with needs_human_review → ArticleToValidate event recorded", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "running");
    await t.mutation(internal.runs.markCompleted, { runId, result: reviewResult });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("events")
        .withIndex("by_instance_created", (q) => q.eq("instanceId", INSTANCE_ID))
        .collect();
      const evt = events.find((e) => e.type === "ArticleToValidate");
      expect(evt).toBeTruthy();
      expect((evt?.payload as Record<string, unknown>)?.missionId).toBe(missionId);
    });
  });

  it("from running with failed result → mission status=failed", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "running");
    await t.mutation(internal.runs.markCompleted, { runId, result: failedResult });

    await t.run(async (ctx) => {
      const m = await ctx.db.get(missionId);
      expect(m?.status).toBe("failed");
      expect(m?.lastResult).toEqual(failedResult);
    });
  });

  it("rejects markCompleted from a non-running status", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t, "dispatching");
    await expect(
      t.mutation(internal.runs.markCompleted, { runId, result: successResult }),
    ).rejects.toThrow(/illegal|transition|status/i);
  });
});

describe("runs.markFailed", () => {
  it("from pending → run failed, mission failed with errorMessage", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "pending");
    await t.mutation(internal.runs.markFailed, { runId, code: "enqueue_error", message: "broker down" });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toMatch(/enqueue_error/);

      const m = await ctx.db.get(missionId);
      expect(m?.status).toBe("failed");
      expect(m?.errorMessage).toMatch(/enqueue_error|broker/);
    });
  });

  it("from running → run failed", async () => {
    const t = convexTest(schema, modules);
    const { runId, missionId } = await seed(t, "running");
    await t.mutation(internal.runs.markFailed, { runId, code: "timeout", message: "stuck" });

    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      expect(run?.status).toBe("failed");
      const m = await ctx.db.get(missionId);
      expect(m?.status).toBe("failed");
    });
  });

  it("rejects markFailed on an already-completed run", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t, "completed");
    await expect(
      t.mutation(internal.runs.markFailed, { runId, code: "x", message: "y" }),
    ).rejects.toThrow(/illegal|transition|status/i);
  });

  it("rejects markFailed on an already-failed run", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seed(t, "failed");
    await expect(
      t.mutation(internal.runs.markFailed, { runId, code: "x", message: "y" }),
    ).rejects.toThrow(/illegal|transition|status/i);
  });
});
