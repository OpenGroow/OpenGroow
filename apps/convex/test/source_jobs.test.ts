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
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
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

const INSTANCE = "openclaw-instance-sj";
const OTHER_INSTANCE = "openclaw-instance-other";
const TEMPLATE = "sources-fixture";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|sj", subject: "owner-sj" };
const OWNER_TOKEN = `test|${OWNER.subject}`;
const NOW = 1_800_000_000_000;

type Harness = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE, OTHER_INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

async function seedInstance(t: Harness, instanceId = INSTANCE, userId = OWNER.subject) {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: `job-${instanceId}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: now,
      openclawId: instanceId,
      updatedAt: now,
      userId,
    }),
  );
}

async function activate(t: Harness, templateId = TEMPLATE, instanceId = INSTANCE) {
  await t.mutation(internal.project_agents.upsert, {
    instanceId,
    templateId,
    status: "active",
    workspaceKey: "ws-sj",
    openclawAgentName: templateId,
  });
}

async function deactivate(t: Harness) {
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE,
    templateId: TEMPLATE,
    status: "inactive",
  });
}

async function getJob(t: Harness, instanceId = INSTANCE, templateId = TEMPLATE) {
  return await t.run((ctx) =>
    ctx.db.query("jobs").filter((q) => q.and(
      q.eq(q.field("instanceId"), instanceId),
      q.eq(q.field("templateId"), templateId),
      q.eq(q.field("type"), "source_ingestion"),
    )).unique().then((job) => job ? { ...job, ...(job.runtime as Record<string, unknown>) } : null),
  );
}

async function makeDue(t: Harness) {
  const job = (await getJob(t))!;
  await t.run((ctx) => ctx.db.patch(job._id, { nextRunAt: NOW - 1 }));
}

async function seedMissionRun(
  t: Harness,
  completedAt: number,
  opts: { instanceId?: string; status?: "completed" | "failed" | "cancelled" | "resumed" } = {},
): Promise<Id<"runs">> {
  const instanceId = opts.instanceId ?? INSTANCE;
  return await t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER.subject, instanceId, templateId: TEMPLATE, type: "x", payload: {},
      status: "done", createdAt: 1, updatedAt: 1,
    });
    return await ctx.db.insert("runs", {
      missionId, ownerId: OWNER.subject, instanceId, templateId: TEMPLATE, agentName: TEMPLATE,
      sessionKey: "k", status: opts.status ?? "completed", completedAt, createdAt: 1, updatedAt: 1,
    });
  });
}

async function seedSource(t: Harness, status: Doc<"sources">["status"] = "ready"): Promise<Id<"sources">> {
  return await t.run((ctx) =>
    ctx.db.insert("sources", {
      instanceId: INSTANCE, ownerId: OWNER.subject, templateId: TEMPLATE, sourceId: "keyword",
      label: "Search keyword", family: "search", status, origin: "o", capturedAt: 1, createdAt: 1,
      marketing: { topics: [] } as never, analysis: {},
    }),
  );
}

async function sourceJobRuns(t: Harness) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("runs").collect()).filter((r) => r.missionId === undefined),
  );
}

/** Fakes the runtime: the exec succeeds, and the RunResult file read returns `outputs`. */
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

async function fireTick(t: Harness) {
  await t.mutation(internal.source_jobs.tick, {});
}

/** Dispatch the pending Run and reconcile it until terminal. */
async function runToTerminal(t: Harness, outputs: unknown) {
  await t.action(internal.mission_dispatcher_node.tick, {}); // dispatch
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {}); // exec ok -> enqueue read
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {}); // read ok -> terminal
}

const SUCCESS = { status: "success", summary: "ok" };

describe("SourceJob lifecycle", () => {
  it("creates an active daily row, cursor at creation, at Activation of an Agent that declares Sources", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = await getJob(t);
    expect(job).toMatchObject({
      state: "active", unit: "daily", cursorAt: NOW, ownerId: OWNER.subject, timezone: "UTC",
    });
    expect(job!.type).toBe("source_ingestion");
    expect(job!.nextRunAt).toBeGreaterThan(NOW);
  });

  it("tells the Agent which RunResult shapes are valid in the run.md it is given", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const payload = (await t.run((ctx) => ctx.db.query("commands").collect()))
      .map((c) => c.payload as { filesToWrite?: Array<{ filePath: string; content: string }> })
      .find((p) => p.filesToWrite);
    const runMd = payload!.filesToWrite!.find((f) => f.filePath.endsWith("run.md"))!.content;
    expect(runMd).toContain('"status": "success"');
    expect(runMd).toContain('"status": "failed"');
    expect(runMd).toContain("in_progress");
    expect(runMd).toContain("`blocked`");
  });

  it("creates no row for an Agent whose Template declares no Sources", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t, "seo");
    expect(await getJob(t, INSTANCE, "seo")).toBeNull();
  });

  it("pauses on deactivation keeping the cursor, and never resumes a paused job when the Agent turns active again", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1234 } }));
    await deactivate(t);
    expect(await getJob(t)).toMatchObject({ state: "paused", cursorAt: 1234 });

    await activate(t);
    expect(await getJob(t)).toMatchObject({ state: "paused", cursorAt: 1234 });
  });

  it("stores the bare subject as ownerId when the instance holds the token identifier", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE, OWNER_TOKEN);
    await activate(t);
    expect((await getJob(t))!.ownerId).toBe(OWNER.subject);
  });

  it("normalizes a job stored with the token identifier when the Agent is re-activated", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { ownerId: OWNER_TOKEN }));
    await activate(t);
    expect((await getJob(t))!.ownerId).toBe(OWNER.subject);
  });
});

describe("SourceJob repairJobs", () => {
  it("normalizes token-identifier owners and creates the missing job of an active Agent, idempotently", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t, INSTANCE, OWNER_TOKEN);
    await seedInstance(t, OTHER_INSTANCE);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { ownerId: OWNER_TOKEN }));
    await activate(t, TEMPLATE, OTHER_INSTANCE);
    const other = (await getJob(t, OTHER_INSTANCE))!;
    await t.run((ctx) => ctx.db.delete(other._id));

    expect(await t.mutation(internal.source_jobs.repairJobs, {})).toEqual({ normalized: 1, created: 1 });
    expect((await getJob(t))!.ownerId).toBe(OWNER.subject);
    expect(await getJob(t, OTHER_INSTANCE)).toMatchObject({ ownerId: OWNER.subject, state: "active" });
    expect(await t.mutation(internal.source_jobs.repairJobs, {})).toEqual({ normalized: 0, created: 0 });
  });
});

describe("SourceJob tick", () => {
  it("does not run a paused or not-yet-due row", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await fireTick(t); // not due
    expect(await sourceJobRuns(t)).toHaveLength(0);
    await makeDue(t);
    await deactivate(t);
    await fireTick(t);
    expect(await sourceJobRuns(t)).toHaveLength(0);
  });

  it("dispatches a Run without a Mission whose context has each Source's merged schema and the batch's Run ids", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1000 } }));
    const inBatch = await seedMissionRun(t, 2000);
    const failedInBatch = await seedMissionRun(t, 3000, { status: "failed" });
    const cancelledInBatch = await seedMissionRun(t, 3500, { status: "cancelled" });
    const resumedInBatch = await seedMissionRun(t, 3600, { status: "resumed" });
    const atCursor = await seedMissionRun(t, 1000); // already covered by the previous batch
    const afterBound = await seedMissionRun(t, NOW + 5000);
    const otherAgent = await seedMissionRun(t, 2500, { instanceId: OTHER_INSTANCE });
    await makeDue(t);

    await fireTick(t);

    const runs = await sourceJobRuns(t);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ instanceId: INSTANCE, templateId: TEMPLATE, status: "pending" });
    const after = (await getJob(t))!;
    expect(after.inFlightRunId).toBe(runs[0]._id);
    expect(after.nextRunAt).toBeGreaterThan(NOW);

    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect())).find((c) => c.type === RUNTIME_OPENCLAW_EXEC)!;
    const payload = exec.payload as { filesToWrite: { filePath: string; content: string }[]; outputsFilePath: string };
    expect(payload.outputsFilePath).toBe(`jobs/${after._id}/outputs/${runs[0]._id}.json`);
    // One run file under the job's folder (mirrors missions/<m>/…), nothing under a top-level runs/.
    expect(payload.filesToWrite.map((f) => f.filePath).filter((p) => p !== "AGENTS.md")).toEqual([
      `jobs/${after._id}/run.md`,
    ]);
    const context = payload.filesToWrite.map((f) => f.content).join("\n");
    for (const id of [inBatch, failedInBatch, cancelledInBatch, resumedInBatch]) expect(context).toContain(id);
    for (const id of [atCursor, afterBound, otherAgent]) expect(context).not.toContain(id);
    // The job's own execution is never in its batch (its id only appears in file paths).
    expect(payload.filesToWrite.find((f) => f.filePath.endsWith("run.md"))!.content).not.toContain(runs[0]._id);
    expect(context).toContain('"keyword"');
    expect(context).toContain('"reel"');
    expect(context).toContain("sources/keyword.md");
    expect(context).toContain('"marketing"'); // merged common layer
    expect(context).toContain('"hook"'); // Source-specific analysis
  });

  it("advances the cursor to the fixed bound on success", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    vi.setSystemTime(NOW + 60_000); // completes later; the bound stays the build time
    await runToTerminal(t, SUCCESS);

    const job = (await getJob(t))!;
    expect(job).toMatchObject({ cursorAt: NOW, lastOutcome: "succeeded", lastRunAt: NOW });
    expect(job.inFlightRunId).toBeUndefined();
    expect(job.lastError).toBeUndefined();
  });

  async function cleanupCommands(t: Harness) {
    return (await t.run((ctx) => ctx.db.query("commands").collect()))
      .filter((c) => c.type === RUNTIME_WORKSPACE_FILE_DELETE_BATCH)
      .map((c) => c.payload as { workspaceKey: string; filePaths: string[] });
  }

  it("deletes the job's run file and result from the workspace once the job succeeds", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    const [run] = await sourceJobRuns(t);
    const job = (await getJob(t))!;
    await runToTerminal(t, SUCCESS);
    expect(await cleanupCommands(t)).toEqual([
      { workspaceKey: "ws-sj", filePaths: [`jobs/${job._id}/run.md`, `jobs/${job._id}/outputs/${run._id}.json`] },
    ]);
  });

  it("deletes them too when the job fails", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    const job = (await getJob(t))!;
    await runToTerminal(t, { status: "failed", summary: "boom", error: { code: "x", message: "boom" } });
    const [command] = await cleanupCommands(t);
    expect(command.filePaths[0]).toBe(`jobs/${job._id}/run.md`);
  });

  it("keeps the files while the job is still running", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    expect(await cleanupCommands(t)).toEqual([]);
  });

  it("keeps the cursor and records lastError on failure, and the same batch is rebuilt next time", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1000 } }));
    await seedMissionRun(t, 2000);
    await makeDue(t);
    await fireTick(t);
    await runToTerminal(t, { status: "failed", summary: "boom", error: { code: "x", message: "boom" } });

    const failed = (await getJob(t))!;
    expect(failed).toMatchObject({ cursorAt: 1000, lastOutcome: "failed" });
    expect(failed.lastError).toBeTruthy();
    expect(failed.inFlightRunId).toBeUndefined();
  });

  it("skips a tick while an execution is in flight, reports skipped and advances the next run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    const first = (await getJob(t))!;
    await t.action(internal.mission_dispatcher_node.tick, {}); // run is now running
    expect((await sourceJobRuns(t))[0].status).toBe("running");

    await t.run((ctx) => ctx.db.patch(first._id, { nextRunAt: NOW - 1 }));
    await fireTick(t);

    const job = (await getJob(t))!;
    expect(await sourceJobRuns(t)).toHaveLength(1);
    expect(job.lastOutcome).toBe("skipped");
    expect(job.nextRunAt).toBeGreaterThan(NOW);
    expect(job.inFlightRunId).toBe(first.inFlightRunId);
  });

  it("includes Runs completed while paused in the batch once the job is resumed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, { runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1000 } }));
    await deactivate(t);
    const whilePaused = await seedMissionRun(t, 5000);
    await activate(t);
    // Only the Jobs page resumes a paused job (`source_jobs.resume`, #547).
    await t.run((ctx) => ctx.db.patch(job._id, { state: "active" }));
    expect((await getJob(t))!.cursorAt).toBe(1000);
    await makeDue(t);
    await fireTick(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect())).find((c) => c.type === RUNTIME_OPENCLAW_EXEC)!;
    const files = (exec.payload as { filesToWrite: { content: string }[] }).filesToWrite;
    expect(files.map((f) => f.content).join("\n")).toContain(whilePaused);
  });
});

describe("SourceJob runNow", () => {
  const STRANGER = { name: "S", email: "s@e.com", tokenIdentifier: "test|other", subject: "stranger" };

  it("starts an execution now on a not-yet-due job and leaves the schedule untouched", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const before = (await getJob(t))!;

    await t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: before._id });

    const job = (await getJob(t))!;
    expect(job.inFlightRunId).toBeDefined();
    expect(job).toMatchObject({ nextRunAt: before.nextRunAt, lastRunAt: NOW, state: "active" });
    expect(await sourceJobRuns(t)).toHaveLength(1);
  });

  it("refuses while an execution is in flight, and for a stranger", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: job._id });

    await expect(t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: job._id })).rejects.toThrow(
      /already running/,
    );
    await expect(t.withIdentity(STRANGER).mutation(api.source_jobs.runNow, { jobId: job._id })).rejects.toThrow();
    expect(await sourceJobRuns(t)).toHaveLength(1);
  });

  it("lets a job whose execution ended without settling it run again, and reports it as not running", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: job._id });
    const [stranded] = await sourceJobRuns(t);
    await t.run((ctx) => ctx.db.patch(stranded._id, { status: "resumed", completedAt: NOW }));

    const rows = await t.withIdentity(OWNER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE });
    expect(rows[0].running).toBe(false);
    await t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: job._id });
    expect(await sourceJobRuns(t)).toHaveLength(2);
  });

  it("refuses when the Agent is not active", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await deactivate(t);
    await expect(t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: job._id })).rejects.toThrow(
      /not active/,
    );
  });
});

describe("Source retry flag", () => {
  it("includes a Source flagged for retry in the next batch regardless of the cursor, and clears it on success", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const sourceId = await seedSource(t, "failed");
    await t.withIdentity(OWNER).mutation(api.sources.retry, { sourceId });
    expect((await t.run((ctx) => ctx.db.get(sourceId)))!.status).toBe("processing");

    await makeDue(t);
    await fireTick(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect())).find((c) => c.type === RUNTIME_OPENCLAW_EXEC)!;
    const files = (exec.payload as { filesToWrite: { content: string }[] }).filesToWrite;
    expect(files.map((f) => f.content).join("\n")).toContain(sourceId);

    await drain(t, SUCCESS);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, SUCCESS);
    await t.action(internal.mission_dispatcher_node.tick, {});
    expect((await t.run((ctx) => ctx.db.get(sourceId)))!.retryRequested).toBeUndefined();
  });
});

describe("SourceJob Jobs page API", () => {
  const STRANGER = { name: "S", email: "s@e.com", tokenIdentifier: "test|other", subject: "stranger" };

  it("starts an execution now without changing the scheduled next run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const before = (await getJob(t))!;

    await t.withIdentity(OWNER).mutation(api.source_jobs.runNow, { jobId: before._id });

    const after = (await getJob(t))!;
    expect(after).toMatchObject({
      inFlightRunId: expect.anything(),
      nextRunAt: before.nextRunAt,
      lastRunAt: NOW,
    });
    expect(await sourceJobRuns(t)).toHaveLength(1);
  });

  it("lists the Agent's job with state, last outcome, last error, next run, and no execution internals", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.run((ctx) =>
      ctx.db.patch(job._id, { lastOutcome: "failed", lastError: "boom", lastRunAt: NOW - 5 }),
    );
    const rows = await t.withIdentity(OWNER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: job._id, templateId: TEMPLATE, agentName: TEMPLATE, state: "active", unit: "daily",
      lastOutcome: "failed", lastError: "boom", nextRunAt: job.nextRunAt, running: false,
    });
    expect(rows[0]).not.toHaveProperty("inFlightBatch");
  });

  it("reports a job with an execution in flight as running", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    await makeDue(t);
    await fireTick(t);
    const rows = await t.withIdentity(OWNER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE });
    expect(rows[0].running).toBe(true);
  });

  it("exposes the workspace and latest Run to deep-link to the job's logs, never the session", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const before = await t.withIdentity(OWNER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE });
    expect(before[0].workspaceKey).toBe("ws-sj");
    expect(before[0].latestRunId).toBeUndefined();
    await makeDue(t);
    await fireTick(t);
    const [run] = await sourceJobRuns(t);
    const rows = await t.withIdentity(OWNER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE });
    expect(rows[0]).toMatchObject({ workspaceKey: "ws-sj", latestRunId: run._id });
    expect(JSON.stringify(rows)).not.toContain(run.sessionKey);
  });

  it("lists nothing for a stranger", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    expect(await t.withIdentity(STRANGER).query(api.source_jobs.listByInstance, { instanceId: INSTANCE })).toEqual([]);
  });

  it("changes the recurrence on the row and recomputes the next run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    await t.withIdentity(OWNER).mutation(api.source_jobs.setFrequency, {
      jobId: job._id,
      frequency: { unit: "weekly", dayOfWeek: 2, hour: 9, minute: 30 },
      timezone: "Europe/Paris",
    });
    const after = (await getJob(t))!;
    expect(after).toMatchObject({ unit: "weekly", dayOfWeek: 2, hour: 9, minute: 30, timezone: "Europe/Paris" });
    expect(after.nextRunAt).toBeGreaterThan(NOW);
    expect(
      new Date(after.nextRunAt).toLocaleString("en-US", {
        timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }),
    ).toBe("Tuesday 09:30");
  });

  it("drops a stale day when switching back to daily, and rejects out-of-range values", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.source_jobs.setFrequency, {
      jobId: job._id, frequency: { unit: "monthly", dayOfMonth: 15, hour: 1, minute: 0 }, timezone: "UTC",
    });
    await owner.mutation(api.source_jobs.setFrequency, {
      jobId: job._id, frequency: { unit: "daily", hour: 7, minute: 0 }, timezone: "UTC",
    });
    expect((await getJob(t))!.dayOfMonth).toBeUndefined();
    await expect(
      owner.mutation(api.source_jobs.setFrequency, {
        jobId: job._id, frequency: { unit: "daily", hour: 24, minute: 0 }, timezone: "UTC",
      }),
    ).rejects.toThrow();
  });

  it("pauses (job not ticked) and resumes with a fresh next run, keeping the cursor", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.source_jobs.pause, { jobId: job._id });
    expect((await getJob(t))!.state).toBe("paused");
    await makeDue(t);
    await fireTick(t);
    expect(await sourceJobRuns(t)).toHaveLength(0);

    await owner.mutation(api.source_jobs.resume, { jobId: job._id });
    const resumed = (await getJob(t))!;
    expect(resumed.state).toBe("active");
    expect(resumed.nextRunAt).toBeGreaterThan(NOW);
    expect(resumed.cursorAt).toBe(job.cursorAt);
  });

  it("keeps a founder-paused job paused when the Agent is re-activated; only source_jobs.resume lifts it", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.source_jobs.pause, { jobId: job._id });

    await activate(t);
    expect((await getJob(t))!.state).toBe("paused");

    await owner.mutation(api.source_jobs.resume, { jobId: job._id });
    expect((await getJob(t))!.state).toBe("active");
  });

  it("forbids a stranger from changing the job", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await getJob(t))!;
    const stranger = t.withIdentity(STRANGER);
    await expect(stranger.mutation(api.source_jobs.pause, { jobId: job._id })).rejects.toThrow("Forbidden");
    await expect(stranger.mutation(api.source_jobs.resume, { jobId: job._id })).rejects.toThrow("Forbidden");
    await expect(
      stranger.mutation(api.source_jobs.setFrequency, {
        jobId: job._id, frequency: { unit: "daily", hour: 1, minute: 0 }, timezone: "UTC",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(stranger.mutation(api.source_jobs.runNow, { jobId: job._id })).rejects.toThrow("Forbidden");
  });
});
