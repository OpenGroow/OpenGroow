import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { join } from "node:path";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
} from "@opengroow/protocol";

import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../sources.ts": () => import("../sources.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
};

const INSTANCE = "openclaw-instance-handoff";
const TEMPLATE = "sources-fixture";
const OWNER = "owner-handoff";
const NOW = 1_800_000_000_000;
const OLD_CURSOR = 1000;

type Harness = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
  // Every dispatcher tick polls awaiting jobs through `fetch`. Never let a test
  // reach a real analysis-mcp (the fixture points at localhost:4000, where a dev
  // stack may be listening and answer 401): the job is still running until a
  // test says otherwise with `mockJob`.
  mockJob({ status: "running" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreRegistry();
});

const getJob = async (t: Harness) => await t.run(async (ctx) => {
  const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).collect())[0]!;
  return { ...job, ...(job.runtime as Record<string, unknown>) };
});
const allSources = (t: Harness) => t.run((ctx) => ctx.db.query("sources").collect());
const jobRuns = (t: Harness) =>
  t.run(async (ctx) =>
    (await ctx.db.query("runs").collect())
      .filter((r) => r.missionId === undefined)
      .sort((a, b) => a._creationTime - b._creationTime),
  );

/** Fakes the runtime; the result file read returns `outputs[n]` for the n-th execution (the last one repeats). */
async function drain(t: Harness, outputs: unknown[]) {
  const runs = await jobRuns(t);
  await t.run(async (ctx) => {
    for (const c of await ctx.db.query("commands").collect()) {
      const eventId = buildRuntimeResultEventId(c._id);
      const seen = await ctx.db.query("events").filter((q) => q.eq(q.field("eventId"), eventId)).first();
      if (seen) continue;
      const p = c.payload as { workspaceKey?: string; filePath?: string };
      let evt: { type: string; payload: unknown } | null = null;
      if (c.type === RUNTIME_OPENCLAW_EXEC) {
        evt = { type: RUNTIME_OPENCLAW_EXEC_RESULT, payload: { commandId: c._id, instanceId: c.instanceId, ok: true } };
      } else if (c.type === RUNTIME_WORKSPACE_FILE_READ) {
        const index = Math.max(0, runs.findIndex((r) => p.filePath?.includes(r._id)));
        const out = outputs[Math.min(index, outputs.length - 1)];
        evt = {
          type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
          payload: {
            commandId: c._id, instanceId: c.instanceId, ok: true,
            data: { workspaceKey: p.workspaceKey, filePath: p.filePath, content: typeof out === "string" ? out : JSON.stringify(out), found: true },
          },
        };
      }
      if (!evt) continue;
      await ctx.db.insert("events", {
        instanceId: c.instanceId, eventId, type: evt.type, payload: evt.payload, ts: Date.now(), createdAt: Date.now(),
      });
    }
  });
}

/** Ticks the job and the dispatcher until the job is no longer in flight. */
async function runJob(t: Harness, outputs: unknown[]) {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "job-handoff", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws-handoff", openclawAgentName: TEMPLATE,
  });
  const job = await getJob(t);
  await t.run((ctx) => ctx.db.patch(job._id, {
    nextRunAt: NOW - 1,
    runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: OLD_CURSOR },
  }));
  await t.mutation(internal.source_jobs.tick, {});
  for (let i = 0; i < 12 && (await getJob(t)).inFlightRunId; i++) {
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
  }
}


const reel = (origin: string, id?: string) => ({
  templateId: TEMPLATE,
  sourceId: "reel",
  ...(id ? { id } : {}),
  common: { origin, capturedAt: 1_700_000_000_000, marketing: {} },
  analysis: { hook: id ? "deep" : "shallow" },
});
const keyword = (origin: string) => ({
  templateId: TEMPLATE,
  sourceId: "keyword",
  common: { origin, capturedAt: 1_700_000_000_000, marketing: {} },
  analysis: { query: "running shoes" },
});
const handoff = (sources: unknown[], position: number | undefined, extra: Record<string, unknown> = {}) => ({
  status: "in_progress",
  summary: "analysis started",
  sources,
  job: { mcpServer: "analysis-mcp", jobId: "job-1", jobType: "analyze", ...(position !== undefined ? { sourcePosition: position } : {}), ...extra },
});
const mockJob = (payload: Record<string, unknown>) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: "OK", headers: { get: () => "application/json" },
    json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } }),
  }));

describe("SourceJob: enrichment handoff through the result file (#568)", () => {
  it("inserts the Sources, links the external job to the one named by position, then completes it on resume", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [handoff([keyword("https://example.com/k"), reel("https://example.com/r")], 1)]);

    const [first] = await jobRuns(t);
    const sources = await allSources(t);
    const reelRow = sources.find((s) => s.sourceId === "reel")!;
    expect(reelRow.status).toBe("processing");
    expect(sources.find((s) => s.sourceId === "keyword")!.status).toBe("ready");
    expect(first.status).toBe("awaiting_job");
    expect(first.mcpJob).toMatchObject({ jobId: "job-1", jobType: "analyze", sourceRef: reelRow._id });
    expect((await getJob(t)).inFlightRunId).toBe(first._id);

    // The shared polling engine resumes the job; the Agent returns the completed Source with its id.
    mockJob({ status: "completed", output: { deep: 1 } });
    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});
    expect(await jobRuns(t)).toHaveLength(2);
    const completion = { status: "success", summary: "done", sources: [reel("https://example.com/r", reelRow._id)] };
    for (let i = 0; i < 6 && (await getJob(t)).inFlightRunId; i++) {
      await t.action(internal.mission_dispatcher_node.tick, {});
      await drain(t, [handoff([], undefined), completion]);
    }
    expect((await t.run((ctx) => ctx.db.get(reelRow._id as Id<"sources">)))!.status).toBe("ready");
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded" });
  });

  it("keeps only the position, never the Source payloads, in the decision log", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [handoff([reel("https://example.com/secret-origin")], 0)]);
    const logs = await t.run((ctx) => ctx.db.query("runReconcileEvents").collect());
    const handoffDecision = logs.find((l) => l.decision.type === "markAwaitingJob")!;
    expect(handoffDecision.decision).toMatchObject({ type: "markAwaitingJob", job: { sourcePosition: 0 } });
    expect(JSON.stringify(logs)).not.toContain("secret-origin");
  });

  it("rejects a position that does not exist with a readable error and resumes the Agent", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [handoff([reel("https://example.com/r")], 5), handoff([reel("https://example.com/r")], 0)]);
    const [first, second] = await jobRuns(t);
    expect(first.status).toBe("completed");
    expect(first.result).toMatchObject({ status: "failed", error: { code: "invalid_sources" } });
    expect(JSON.stringify(first.result)).toContain("sourcePosition");
    expect(second.resumedFromRunId).toBe(first._id);
  });

  it("rejects a handoff that names its Source neither by position nor by id", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [handoff([reel("https://example.com/r")], undefined)]);
    const job = await getJob(t);
    expect(job.lastOutcome).toBe("failed");
    expect(job.lastError).toContain("exactly one of sourcePosition");
    expect(await allSources(t)).toHaveLength(0);
  });

  it("rejects the completion of a Source that is not processing with a readable error", async () => {
    const t = convexTest(schema, modules);
    let readyId = "";
    const outputsFor = async () => {
      readyId = await t.mutation(internal.sources.insert, {
        instanceId: INSTANCE, ownerId: OWNER, templateId: TEMPLATE, sourceId: "reel", label: "Video post",
        family: "social-video", status: "ready", origin: "https://example.com/done", capturedAt: 1, marketing: {}, analysis: { hook: "x" },
      });
    };
    await runJob(t, [handoff([reel("https://example.com/r")], 0)]);
    const [first] = await jobRuns(t);
    const ready = await t.mutation(internal.sources.insert, {
      instanceId: INSTANCE, ownerId: OWNER, templateId: TEMPLATE, sourceId: "reel", label: "Video post",
      family: "social-video", status: "ready", origin: "https://example.com/done", capturedAt: 1, marketing: {}, analysis: { hook: "x" },
    });
    mockJob({ status: "completed", output: { deep: 1 } });
    await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});
    expect((await jobRuns(t))[0]!._id).toBe(first._id);
    const completion = { status: "success", summary: "d", sources: [reel("https://example.com/done", ready)] };
    for (let i = 0; i < 12 && (await getJob(t)).inFlightRunId; i++) {
      await t.action(internal.mission_dispatcher_node.tick, {});
      await drain(t, [handoff([], undefined), completion]);
    }
    const job = await getJob(t);
    expect(job.lastOutcome).toBe("failed");
    expect(job.lastError).toContain("only a processing Source can be completed");
  });

  it("hands off nothing for a cancelled Run", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    await t.run((ctx) =>
      insertInstance(ctx, {
        jobId: "job-handoff", status: "running", runtimeStatus: "linked", runtimeReady: true,
        createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER,
      }),
    );
    await t.mutation(internal.project_agents.upsert, {
      instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws-handoff", openclawAgentName: TEMPLATE,
    });
    const job = await getJob(t);
    await t.run((ctx) => ctx.db.patch(job._id, { nextRunAt: NOW - 1 }));
    await t.mutation(internal.source_jobs.tick, {});
    const [run] = await jobRuns(t);
    await t.run((ctx) => ctx.db.patch(run._id, { status: "cancelled" }));
    await t.mutation(internal.runs.markAwaitingJob, {
      runId: run._id,
      job: { serverName: "analysis-mcp", jobId: "j", summary: "s", reviewQuestions: [], jobType: "analyze", sourcePosition: 0 },
      sources: [reel("https://example.com/r")],
    });
    expect(await allSources(t)).toHaveLength(0);
    expect((await jobRuns(t))[0]!.status).toBe("cancelled");
  });
});
