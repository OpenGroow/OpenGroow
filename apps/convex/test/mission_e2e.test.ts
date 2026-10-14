import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  type Command,
} from "@opengroow/protocol";
import { createMissionAwareDispatcher } from "../../fake-openclaw/src/openclaw-agent.js";
import type { Doc } from "../_generated/dataModel";

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
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const INSTANCE_ID = "openclaw-instance-e2e";
const TEMPLATE_ID = "@opengroow/seo";

// Mission lifecycle resolves Templates through the in-memory registry (Project = Instance id).
useTemplateRegistry([INSTANCE_ID], [TEMPLATE_ID]);
const OPENCLAW_AGENT = "seo";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|e2e", subject: "owner-e2e" };

async function seedInstanceAndAgent(t: ReturnType<typeof convexTest>) {
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
      userId: OWNER.subject,
    });
    const ts = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      status: "active",
      workspaceKey: "ws-e2e",
      openclawAgentName: OPENCLAW_AGENT,
      mcpServerKeys: [],
      config: { seoProjectId: "proj-e2e", apiKey: "key-e2e" },
      createdAt: ts,
      updatedAt: ts,
    });
  });
}

type DispatchOverride = (cmd: Command, instanceId: string) => unknown | undefined;

async function drainCommands(
  t: ReturnType<typeof convexTest>,
  dispatch: ReturnType<typeof createMissionAwareDispatcher>,
  override?: DispatchOverride,
): Promise<void> {
  await t.run(async (ctx) => {
    const cmds = await ctx.db.query("commands").collect();
    for (const c of cmds) {
      const eventId = buildRuntimeResultEventId(c._id);
      const exists = await ctx.db
        .query("events")
        .filter((q) =>
          q.and(q.eq(q.field("instanceId"), c.instanceId), q.eq(q.field("eventId"), eventId)),
        )
        .first();
      if (exists) continue;

      const command: Command = { id: c._id, type: c.type, payload: c.payload, ts: c.createdAt };
      const overridden = override?.(command, c.instanceId);
      const result = overridden !== undefined ? overridden : dispatch(command, c.instanceId);
      if (!result) continue;
      const evt = result as { id: string; type: string; payload: unknown; ts: number };
      await ctx.db.insert("events", {
        instanceId: c.instanceId,
        eventId: evt.id,
        type: evt.type,
        payload: evt.payload ?? null,
        ts: evt.ts,
        createdAt: Date.now(),
      });
    }
  });
}

describe("mission e2e — happy path", () => {
  it("creating an SEO mission flows through tick(), reconcile, and completes with status=to_validate", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceAndAgent(t);
    const dispatch = createMissionAwareDispatcher();

    const { missionId, runId } = await t
      .withIdentity(OWNER)
      .mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "octopus" },
        name: "Test Mission",
      });

    // Tick 1: dispatch (pending → running, 3 commands enqueued)
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);

    // Tick 2: reconcile sees exec ok=true, dispatches FILE_READ
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);

    // Tick 3: reconcile sees FILE_READ_RESULT with content, completes the run
    await t.action(internal.mission_dispatcher_node.tick, {});

    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(mission.status).toBe("to_validate");
    expect(mission.lastResult?.status).toBe("needs_human_review");

    const outputsContent = await t.run(async (ctx) => {
      const reads = await ctx.db
        .query("commands")
        .filter((q) => q.eq(q.field("type"), "runtime.workspace.file.read"))
        .collect();
      const evts = await Promise.all(
        reads.map((r) =>
          ctx.db
            .query("events")
            .filter((q) =>
              q.and(
                q.eq(q.field("instanceId"), r.instanceId),
                q.eq(q.field("eventId"), buildRuntimeResultEventId(r._id)),
              ),
            )
            .first(),
        ),
      );
      return evts.find((e) => {
        const p = e?.payload as { data?: { filePath?: string } } | undefined;
        return p?.data?.filePath === `missions/${missionId}/outputs/${runId}.json`;
      });
    });
    expect(outputsContent).toBeDefined();
    const payload = outputsContent!.payload as { data: { content: string } };
    expect(JSON.parse(payload.data.content).status).toBe("needs_human_review");
  });
});

describe("mission e2e — failure path", () => {
  it("when fake runtime emits exec ok:false, run and mission both end in failed with code runtime", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceAndAgent(t);
    const dispatch = createMissionAwareDispatcher();
    const failureOverride: DispatchOverride = (cmd, instanceId) => {
      if (cmd.type !== "runtime.openclaw.exec") return undefined;
      return {
        id: buildRuntimeResultEventId(cmd.id!),
        type: RUNTIME_OPENCLAW_EXEC_RESULT,
        payload: { commandId: cmd.id, instanceId, ok: false, error: "simulated failure" },
        ts: Date.now(),
      };
    };

    const { missionId, runId } = await t
      .withIdentity(OWNER)
      .mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
      });

    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch, failureOverride);
    await t.action(internal.mission_dispatcher_node.tick, {});

    const run = (await t.run(async (ctx) => ctx.db.get(runId))) as Doc<"runs">;
    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(run.status).toBe("failed");
    expect(mission.status).toBe("failed");
    expect(run.errorMessage).toContain("runtime:");
  });
});

describe("mission e2e — timeout reconciliation", () => {
  it("a dispatching run with no dispatchCommandId is marked failed(timeout) after MISSION_RUN_MAX_MS", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceAndAgent(t);

    // Manual seed: a Run claimed by a dispatcher that crashed before enqueuing
    // the openclaw exec command — no dispatchCommandId, dispatchedAt in the
    // distant past so the timeout rule fires.
    const { missionId, runId } = await t.run(async (ctx) => {
      const old = Date.now() - 2_000_000;
      const mid = await ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: {},
        name: "Test Mission",
        status: "todo",
        createdAt: old,
        updatedAt: old,
      });
      const rid = await ctx.db.insert("runs", {
        missionId: mid,
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        agentName: OPENCLAW_AGENT,
        sessionKey: `mega-mission-${mid}`,
        status: "dispatching",
        dispatchedAt: old,
        createdAt: old,
        updatedAt: old,
      });
      return { missionId: mid, runId: rid };
    });

    await t.action(internal.mission_dispatcher_node.tick, {});

    const run = (await t.run(async (ctx) => ctx.db.get(runId))) as Doc<"runs">;
    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toContain("timeout:");
    expect(run.errorMessage).toMatch(/Run exceeded \d+ ms/);
    expect(mission.status).toBe("failed");
  });
});

describe("mission e2e — needs_human_review path", () => {
  it("maps a needs_human_review RunResult to mission status to_validate", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceAndAgent(t);
    const dispatch = createMissionAwareDispatcher();

    const { missionId, runId } = await t
      .withIdentity(OWNER)
      .mutation(api.missions.create, {
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "octopus" },
        name: "Test Mission",
      });

    const outputsPath = `missions/${missionId}/outputs/${runId}.json`;
    const reviewOverride: DispatchOverride = (cmd, instanceId) => {
      if (cmd.type !== RUNTIME_WORKSPACE_FILE_READ) return undefined;
      const p = cmd.payload as { workspaceKey?: string; filePath?: string } | undefined;
      if (p?.filePath !== outputsPath) return undefined;
      return {
        id: buildRuntimeResultEventId(cmd.id!),
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: {
          commandId: cmd.id,
          instanceId,
          ok: true,
          data: {
            workspaceKey: p?.workspaceKey,
            filePath: outputsPath,
            content: JSON.stringify({
              status: "needs_human_review",
              summary: "manual check",
              reviewQuestions: ["Is the tone appropriate?"],
            }),
            found: true,
          },
        },
        ts: Date.now(),
      };
    };

    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch, reviewOverride);
    await t.action(internal.mission_dispatcher_node.tick, {});

    const mission = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    const run = (await t.run(async (ctx) => ctx.db.get(runId))) as Doc<"runs">;
    expect(run.status).toBe("completed");
    expect(mission.status).toBe("to_validate");
    expect(mission.lastResult?.status).toBe("needs_human_review");
  });
});

describe("mission e2e — reject and revision loop", () => {
  it("performReviewAction(reject) → new Run dispatched with feedback → revision run with needs_human_review → mission back to to_validate", async () => {
    const t = convexTest(schema, modules);
    await seedInstanceAndAgent(t);
    const dispatch = createMissionAwareDispatcher();

    // Seed a mission already in to_validate (simulates a prior run completing with needs_human_review)
    const missionId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: "create_article",
        payload: { keyword: "octopus" },
        name: "Test Mission",
        status: "to_validate",
        lastResult: {
          status: "needs_human_review",
          summary: "review needed",
          reviewQuestions: ["Is the tone ok?"],
          artifact: {
            kind: "markdown",
            external: { service: "article-mcp", id: "art-e2e-1" },
            metadata: {},
          },
        },
        createdAt: now,
        updatedAt: now,
      });
    });

    // User rejects with feedback via the generic engine
    const feedback = "The tone is too formal. Use a friendlier voice.";
    await t
      .withIdentity(OWNER)
      .action(api.missions_node.performReviewAction, { missionId, actionKey: "reject", input: { feedback } });

    // Retrieve the revision runId from the DB
    const revisionRunId = await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .collect();
      return runs[0]._id;
    });

    // Mission should be doing, new run pending
    const missionAfterReject = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    expect(missionAfterReject.status).toBe("doing");

    // Simulate the revision run completing with needs_human_review again
    const outputsPath = `missions/${missionId}/outputs/${revisionRunId}.json`;
    const revisionOverride: DispatchOverride = (cmd, instanceId) => {
      if (cmd.type !== RUNTIME_WORKSPACE_FILE_READ) return undefined;
      const p = cmd.payload as { workspaceKey?: string; filePath?: string } | undefined;
      if (p?.filePath !== outputsPath) return undefined;
      return {
        id: buildRuntimeResultEventId(cmd.id!),
        type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
        payload: {
          commandId: cmd.id,
          instanceId,
          ok: true,
          data: {
            workspaceKey: p?.workspaceKey,
            filePath: outputsPath,
            content: JSON.stringify({
              status: "needs_human_review",
              summary: "revised, still needs review",
              reviewQuestions: ["Better tone now?"],
            }),
            found: true,
          },
        },
        ts: Date.now(),
      };
    };

    // Tick 1: dispatch the revision run (pending → running)
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch);

    // Tick 2: reconcile sees exec ok=true, dispatches FILE_READ
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drainCommands(t, dispatch, revisionOverride);

    // Tick 3: reconcile reads needs_human_review → mission back to to_validate
    await t.action(internal.mission_dispatcher_node.tick, {});

    const missionFinal = (await t.run(async (ctx) => ctx.db.get(missionId))) as Doc<"missions">;
    const revisionRun = (await t.run(async (ctx) => ctx.db.get(revisionRunId))) as Doc<"runs">;
    expect(revisionRun.status).toBe("completed");
    expect(missionFinal.status).toBe("to_validate");
    expect(missionFinal.lastResult?.status).toBe("needs_human_review");

    // ReviewRejected and ArticleToValidate events should have been recorded
    const events = await t.run(async (ctx) =>
      ctx.db.query("events").withIndex("by_instance_created", (q) => q.eq("instanceId", INSTANCE_ID)).collect(),
    );
    expect(events.find((e) => e.type === "ReviewRejected")).toBeTruthy();
    expect(events.find((e) => e.type === "ArticleToValidate")).toBeTruthy();
  });
});
