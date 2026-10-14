import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  buildRuntimeResultEventId,
} from "@opengroow/protocol";

// Reproducing the real race (reconcileRuns' listRunsToReconcile query only
// selects `running`/`dispatching`/`awaiting_job` Runs, so a Run already
// `cancelled` by Stop is never even picked up — the actual race window is a
// live interleaving between reconcileRun computing a `markCompleted` decision
// and `runs.markCompleted` executing, racing a concurrent `runs.markCancelled`
// from `missions_node.cancelMission`) is not reproducible deterministically in
// a single-threaded unit test. Instead, this isolates exactly the contract
// Fix 3 (issue #482) adds: `runs.markCompleted` is mocked to report
// `applied: false` — the same value it returns for real when it no-ops
// against an already-`cancelled` Run (see runs.ts) — and this test asserts
// `mission_dispatcher_node.reconcileRun`'s `markCompleted` case honors that
// by skipping its terminal-decision follow-ups instead of calling them
// unconditionally.
vi.mock("../runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runs")>();
  const { internalMutation } = await import("../_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    markCompleted: internalMutation({
      args: { runId: v.id("runs"), result: v.any() },
      handler: async (): Promise<{ applied: boolean }> => {
        return { applied: false };
      },
    }),
  };
});

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
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const INSTANCE_ID = "openclaw-instance-race";
const OWNER_ID = "owner-race";

describe("mission_dispatcher_node.reconcileRun's markCompleted case (issue #482)", () => {
  it("skips terminal-decision follow-ups when runs.markCompleted reports applied: false", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      const nowIso = new Date(now).toISOString();
      await insertInstance(ctx, {
        jobId: `job-${INSTANCE_ID}`,
        status: "running",
        createdAt: nowIso,
        openclawId: INSTANCE_ID,
        updatedAt: nowIso,
        userId: OWNER_ID,
      });
    });

    const { runId, missionId } = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: "generic-agent",
        type: "generic_mission",
        payload: {},
        status: "doing",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("runs", {
        missionId,
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: "generic-agent",
        agentName: "generic-agent",
        sessionKey: `mega-mission-${missionId}`,
        status: "running",
        createdAt: now,
        updatedAt: now,
      });

      const execId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_OPENCLAW_EXEC,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      const readId = await ctx.db.insert("commands", {
        instanceId: INSTANCE_ID,
        type: RUNTIME_WORKSPACE_FILE_READ,
        payload: {},
        status: "queued",
        attempts: 0,
        createdAt: now,
      });
      await ctx.db.patch(runId, { dispatchCommandId: execId, resultReadCommandId: readId });
      await ctx.db.insert("projectAgents", {
        instanceId: INSTANCE_ID,
        templateId: "generic-agent",
        workspaceKey: "ws-generic-race",
        openclawAgentName: "generic-agent",
        status: "active",
        mcpServerKeys: [],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(execId),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { ok: true },
        ts: now,
        createdAt: now,
      });
      await ctx.db.insert("events", {
        instanceId: INSTANCE_ID,
        eventId: buildRuntimeResultEventId(readId),
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: {
          ok: true,
          data: {
            content: JSON.stringify({
              status: "success",
              summary: "Done.",
              additionalDetails: {},
            }),
          },
        },
        ts: now,
        createdAt: now,
      });

      return { runId, missionId };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    await t.run(async (ctx) => {
      // The mocked markCompleted never patches the Run/Mission — reconcileRun
      // must not have written anything else on top either.
      const run = await ctx.db.get(runId);
      const mission = await ctx.db.get(missionId);
      expect(run?.status).toBe("running");
      expect(mission?.status).toBe("doing");
    });
  });
});
