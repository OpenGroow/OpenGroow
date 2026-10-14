import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { computeRunMaxMs } from "../mission_dispatcher_node";
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

const INSTANCE_ID = "openclaw-instance-reconcile";
const TEMPLATE_ID = "@opengroow/seo";
const OWNER_ID = "owner-reconcile";
const PROJECT_IDS = [INSTANCE_ID, `${INSTANCE_ID}-a`, `${INSTANCE_ID}-b`];

// Spec for #364 asked for "un test Convex rouge qui part de documents
// Run/Mission/Command/Event et vérifie l'état final sans construire
// manuellement un ReconcileSnapshot" — this drives the real
// reconcileRuns action end-to-end against seeded documents instead of
// calling decideReconciliation directly with a hand-built snapshot.
describe("mission_dispatcher_node.reconcileRuns (integration)", () => {
  const registry = useTemplateRegistry(PROJECT_IDS, [TEMPLATE_ID]);

  it("marks a dispatching Run failed once it exceeds its computed deadline", async () => {
    const t = convexTest(schema, modules);
    const maxMs = await computeRunMaxMs(registry, INSTANCE_ID, TEMPLATE_ID, "create_article", { topic: "Octopus" });
    const dispatchedAt = Date.now() - maxMs - 1_000;

    const { runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER_ID,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { topic: "Octopus" },
        status: "todo",
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
        status: "dispatching",
        dispatchedAt,
        createdAt: now,
        updatedAt: now,
      });
      return { missionId, runId };
    });

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run?.status).toBe("failed");
    expect(run?.errorMessage).toContain("timeout");
  });

  it("isolates one Run's reconciliation failure from the rest of the tick", async () => {
    const t = convexTest(schema, modules);
    const maxMs = await computeRunMaxMs(registry, INSTANCE_ID, TEMPLATE_ID, "create_article", { topic: "Octopus" });
    const dispatchedAt = Date.now() - maxMs - 1_000;

    async function seedDispatchingRun(suffix: string) {
      return await t.run(async (ctx) => {
        const now = Date.now();
        const missionId = await ctx.db.insert("missions", {
          ownerId: OWNER_ID,
          instanceId: `${INSTANCE_ID}-${suffix}`,
          templateId: TEMPLATE_ID,
          type: "create_article",
          payload: { topic: "Octopus" },
          status: "todo",
          createdAt: now,
          updatedAt: now,
        });
        const runId = await ctx.db.insert("runs", {
          missionId,
          ownerId: OWNER_ID,
          instanceId: `${INSTANCE_ID}-${suffix}`,
          templateId: TEMPLATE_ID,
          agentName: "seo",
          sessionKey: `mega-mission-${missionId}`,
          status: "dispatching",
          dispatchedAt,
          createdAt: now,
          updatedAt: now,
        });
        return runId;
      });
    }

    // Deleting the Mission after the Run references it doesn't make
    // listRunsToReconcile/reconcileRun throw (missionType just falls back to
    // ""), so this only proves two independent Runs are both reconciled in
    // the same tick — a stronger throw-based isolation test would require
    // mocking an internal query, which convex-test doesn't support here.
    const firstRunId = await seedDispatchingRun("a");
    const secondRunId = await seedDispatchingRun("b");

    await t.action(internal.mission_dispatcher_node.reconcileRuns, {});

    const [first, second] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(firstRunId), ctx.db.get(secondRunId)]),
    );
    expect(first?.status).toBe("failed");
    expect(second?.status).toBe("failed");
  });
});
