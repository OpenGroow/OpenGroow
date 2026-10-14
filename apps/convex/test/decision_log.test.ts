import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

import { useTemplateRegistry } from "./helpers/template_registry.helpers";
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

const OWNER_ID = "owner-decision-log";
const INSTANCE_ID = "inst-decision-log";
const TEMPLATE_ID = "@opengroow/seo";

useTemplateRegistry([INSTANCE_ID], [TEMPLATE_ID]);

async function seedRun(t: ReturnType<typeof convexTest>): Promise<{
  missionId: Id<"missions">;
  runId: Id<"runs">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "create_article",
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
      agentName: "seo",
      sessionKey: `mega-mission-${missionId}`,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

describe("mission_dispatcher.recordReconcileDecision / listReconcileDecisions", () => {
  it("records a decision and it shows up in the log in order", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "enqueueRead", role: "result", filePath: "missions/m1/outputs/r1.json" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "markCompleted", result: { status: "success", summary: "done" } },
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(2);
    expect(log[0].decision).toEqual({
      type: "enqueueRead",
      role: "result",
      filePath: "missions/m1/outputs/r1.json",
    });
    expect(log[1].decision).toEqual({
      type: "markCompleted",
      result: { status: "success", summary: "done" },
    });
    expect(log[0].createdAt).toBeLessThanOrEqual(log[1].createdAt);
  });

  it("collapses consecutive wait decisions into a single logged row", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "wait" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "wait" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "wait" },
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log).toHaveLength(1);
    expect(log[0].decision).toEqual({ type: "wait" });
  });

  it("accepts historical SourceJob ingestion decisions", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: {
        type: "ingestSources",
        result: { status: "success", summary: "Ingested one Source." },
        sourceCount: 1,
      },
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log[0]?.decision).toEqual({
      type: "ingestSources",
      result: { status: "success", summary: "Ingested one Source." },
      sourceCount: 1,
    });
  });

  it("accepts historical SourceJob handoff positions", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: {
        type: "markAwaitingJob",
        job: {
          serverName: "analysis-mcp",
          jobId: "job-1",
          summary: "Enrichment in progress",
          reviewQuestions: [],
          jobType: "analyze_reel",
          missionType: "",
          sourcePosition: 0,
        },
      },
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log[0]?.decision).toMatchObject({
      type: "markAwaitingJob",
      job: { sourcePosition: 0 },
    });
  });

  it("logs a wait again once a non-wait decision has broken the run of waits", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "wait" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "enqueueRead", role: "result", filePath: "missions/m1/outputs/r1.json" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId,
      missionId,
      decision: { type: "wait" },
    });

    const log = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId });
    expect(log.map((d) => d.decision.type)).toEqual(["wait", "enqueueRead", "wait"]);
  });

  it("keeps each run's log independent", async () => {
    const t = convexTest(schema, modules);
    const { missionId, runId: runA } = await seedRun(t);
    const { runId: runB } = await seedRun(t);

    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId: runA,
      missionId,
      decision: { type: "wait" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId: runB,
      missionId,
      decision: { type: "wait" },
    });
    await t.mutation(internal.mission_dispatcher.recordReconcileDecision, {
      runId: runA,
      missionId,
      decision: { type: "wait" },
    });

    const logA = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId: runA });
    const logB = await t.query(internal.mission_dispatcher.listReconcileDecisions, { runId: runB });
    expect(logA).toHaveLength(1);
    expect(logB).toHaveLength(1);
  });
});
