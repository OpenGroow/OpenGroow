import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
} from "@opengroow/protocol";

// Issue #533, ADR-051: enrichment is a phase of the SourceJob. An execution
// hands off an external job for a `processing` Source and ends; the shared
// polling engine polls the declared MCP; a terminal state resumes the same
// SourceJob with a new execution (or settles the Source `failed` /
// `unavailable`); the job succeeds only when an execution ends with no
// further handoff.

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

const INSTANCE = "openclaw-instance-enrich";
const TEMPLATE = "sources-fixture";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|en", subject: "owner-en" };
const NOW = 1_800_000_000_000;

type Harness = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreRegistry();
});

async function setup(t: Harness) {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "job-en", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: TEMPLATE, status: "active",
    workspaceKey: "ws-en", openclawAgentName: TEMPLATE,
  });
}

async function getJob(t: Harness) {
  return await t.run(async (ctx) => {
    const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).collect())[0]!;
    return { ...job, ...(job.runtime as Record<string, unknown>) };
  });
}

async function makeDueAndTick(t: Harness) {
  const job = await getJob(t);
  await t.run((ctx) => ctx.db.patch(job._id, { nextRunAt: NOW - 1 }));
  await t.mutation(internal.source_jobs.tick, {});
}

/** What the route does for a Source with enrichment declared: a `processing` row. */
async function writeProcessingSource(t: Harness, sourceId = "reel"): Promise<Id<"sources">> {
  return await t.mutation(internal.sources.insert, {
    instanceId: INSTANCE, ownerId: OWNER.subject, templateId: TEMPLATE, sourceId,
    label: "Video post", family: "social-video", status: "processing",
    origin: "https://example.com/r/1", capturedAt: 1, marketing: {}, analysis: { hook: "shallow" },
  });
}

async function drain(t: Harness, outputs: unknown) {
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
        evt = {
          type: RUNTIME_WORKSPACE_FILE_READ_RESULT,
          payload: {
            commandId: c._id, instanceId: c.instanceId, ok: true,
            data: { workspaceKey: p.workspaceKey, filePath: p.filePath, content: JSON.stringify(outputs), found: true },
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

/** Dispatch the pending Run and reconcile it until the Agent's RunResult is applied. */
async function runSession(t: Harness, outputs: unknown) {
  await t.action(internal.mission_dispatcher_node.tick, {});
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {});
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {});
}

function handoff(sourceRef: string, jobId = "job-1") {
  return {
    status: "in_progress",
    summary: "analysis started",
    reviewQuestions: [],
    job: { mcpServer: "analysis-mcp", jobId, jobType: "analyze", sourceRef },
  };
}

function mockJobStatus(payload: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: "OK", headers: { get: () => "application/json" },
    json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function runs(t: Harness): Promise<Doc<"runs">[]> {
  return (await t.run((ctx) => ctx.db.query("runs").collect())).sort((a, b) => a._creationTime - b._creationTime);
}

async function poll(t: Harness) {
  await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});
}

async function startAwaiting(t: Harness) {
  await setup(t);
  await makeDueAndTick(t);
  const sourceRef = await writeProcessingSource(t);
  await runSession(t, handoff(sourceRef));
  return sourceRef;
}

describe("SourceJob enrichment phase", () => {
  it("parks the execution as awaiting_job with the Source reference and keeps the job in flight", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    const [run] = await runs(t);
    expect(run.status).toBe("awaiting_job");
    expect(run.mcpJob).toMatchObject({ jobId: "job-1", jobType: "analyze", sourceRef });
    const job = await getJob(t);
    expect(job.inFlightRunId).toBe(run._id);
    expect(job.lastOutcome).toBeUndefined();
  });

  it("skips ticks while the enrichment is in flight", async () => {
    const t = convexTest(schema, modules);
    await startAwaiting(t);
    await makeDueAndTick(t);
    expect(await runs(t)).toHaveLength(1);
    expect((await getJob(t)).lastOutcome).toBe("skipped");
  });

  it("keeps waiting while the external job is still running", async () => {
    const t = convexTest(schema, modules);
    await startAwaiting(t);
    const fetchMock = mockJobStatus({ status: "running" });
    await poll(t);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.params).toMatchObject({ name: "get_status", arguments: { runId: "job-1" } });
    expect((await runs(t))[0].status).toBe("awaiting_job");
    expect(await runs(t)).toHaveLength(1);
  });

  it("resumes the same SourceJob with a new execution that receives the MCP result", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    mockJobStatus({ status: "completed", output: { deep: "analysis-payload" } });
    await poll(t);

    const all = await runs(t);
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe("resumed");
    expect(all[1]).toMatchObject({ status: "pending", jobId: (all[0] as { jobId?: unknown }).jobId, resumedFromRunId: all[0]._id });
    expect(all[1].missionId).toBeUndefined();
    const job = await getJob(t);
    expect(job.inFlightRunId).toBe(all[1]._id);
    // The Source stays processing until the resumed execution completes it.
    expect((await t.run((ctx) => ctx.db.get(sourceRef)))!.status).toBe("processing");

    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect()))
      .filter((c) => c.type === RUNTIME_OPENCLAW_EXEC)
      .at(-1)!;
    const files = (exec.payload as { filesToWrite: { filePath: string; content: string }[] }).filesToWrite;
    const context = files.find((f) => f.filePath.endsWith("run.md"))!.content;
    expect(context).toContain(sourceRef);
    expect(context).toContain("analysis-payload");
    expect(context).toContain('"id"'); // how to complete the Source through the route
    expect(context).not.toContain("## Runs to process"); // the batch is not re-ingested
  });

  it("reports the job succeeded only when a resumed execution ends without a further handoff", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    mockJobStatus({ status: "completed", output: { deep: "x" } });
    await poll(t);
    // Not settled yet: the first execution only handed off.
    expect((await getJob(t)).lastOutcome).toBeUndefined();

    await t.mutation(internal.sources.complete, {
      id: sourceRef, instanceId: INSTANCE, templateId: TEMPLATE, sourceId: "reel",
      origin: "https://example.com/r/1", capturedAt: 1, marketing: {}, analysis: { hook: "deep" },
    });
    await runSession(t, { status: "success", summary: "completed" });

    const job = await getJob(t);
    expect(job).toMatchObject({ lastOutcome: "succeeded", cursorAt: NOW });
    expect(job.inFlightRunId).toBeUndefined();
    const source = (await t.run((ctx) => ctx.db.get(sourceRef)))!;
    expect(source).toMatchObject({ status: "ready", analysis: { hook: "deep" } });
  });

  it("chains a further handoff instead of succeeding", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    const second = await writeProcessingSource(t);
    mockJobStatus({ status: "completed", output: { deep: "x" } });
    await poll(t);
    await t.mutation(internal.sources.complete, {
      id: sourceRef, instanceId: INSTANCE, templateId: TEMPLATE, sourceId: "reel",
      origin: "o", capturedAt: 1, marketing: {}, analysis: { hook: "deep" },
    });
    await runSession(t, handoff(second, "job-2"));

    const job = await getJob(t);
    expect(job.lastOutcome).toBeUndefined();
    const all = await runs(t);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ status: "awaiting_job" });
    expect(all[1].mcpJob).toMatchObject({ jobId: "job-2", sourceRef: second });
    expect(job.inFlightRunId).toBe(all[1]._id);
  });

  it("maps a failed job to a retryable failed Source and settles the job when nothing else awaits", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    mockJobStatus({ status: "failed", error: { code: "internal_error", message: "boom" } });
    await poll(t);

    expect((await t.run((ctx) => ctx.db.get(sourceRef)))!.status).toBe("failed");
    const job = await getJob(t);
    expect(job).toMatchObject({ lastOutcome: "succeeded", cursorAt: NOW });
    expect(job.inFlightRunId).toBeUndefined();
    expect(await runs(t)).toHaveLength(1);
    expect((await runs(t))[0].status).toBe("resumed");
  });

  it("maps an unanalyzable job to an unavailable Source that cannot be retried", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    // Fixture polling block declares no unavailable codes: an empty completed result is unanalyzable.
    mockJobStatus({ status: "completed" });
    await poll(t);

    expect((await t.run((ctx) => ctx.db.get(sourceRef)))!.status).toBe("unavailable");
    await expect(
      t.withIdentity(OWNER).mutation(api.sources.retry, { sourceId: sourceRef }),
    ).rejects.toThrow();
    expect((await getJob(t)).lastOutcome).toBe("succeeded");
  });

  it("continues with a new execution after a failed job when another Source still awaits its handoff", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    const waiting = await writeProcessingSource(t);
    mockJobStatus({ status: "failed", error: "boom" });
    await poll(t);

    expect((await t.run((ctx) => ctx.db.get(sourceRef)))!.status).toBe("failed");
    const all = await runs(t);
    expect(all).toHaveLength(2);
    expect(all[1].status).toBe("pending");
    expect((await getJob(t)).lastOutcome).toBeUndefined();

    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect()))
      .filter((c) => c.type === RUNTIME_OPENCLAW_EXEC)
      .at(-1)!;
    const files = (exec.payload as { filesToWrite: { content: string }[] }).filesToWrite;
    expect(files.map((f) => f.content).join("\n")).toContain(waiting);
  });

  it("fails the run, not the Source, when the handoff does not name a processing Source", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await makeDueAndTick(t);
    await runSession(t, handoff("nope"));
    mockJobStatus({ status: "completed", output: { a: 1 } });
    await poll(t);

    expect((await runs(t))[0].status).toBe("failed");
    expect((await getJob(t)).lastOutcome).toBe("failed");
  });

  it("puts a retried Source back into the next tick's batch after its enrichment failed", async () => {
    const t = convexTest(schema, modules);
    const sourceRef = await startAwaiting(t);
    mockJobStatus({ status: "failed", error: "boom" });
    await poll(t);
    await t.withIdentity(OWNER).mutation(api.sources.retry, { sourceId: sourceRef });
    expect((await t.run((ctx) => ctx.db.get(sourceRef)))!.status).toBe("processing");

    await makeDueAndTick(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect()))
      .filter((c) => c.type === RUNTIME_OPENCLAW_EXEC)
      .at(-1)!;
    const files = (exec.payload as { filesToWrite: { content: string }[] }).filesToWrite;
    expect(files.map((f) => f.content).join("\n")).toContain(sourceRef);
  });
});
