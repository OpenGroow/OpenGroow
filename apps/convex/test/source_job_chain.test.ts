import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { join } from "node:path";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
} from "@opengroow/protocol";
import { MAX_CHAINED_EXECUTIONS } from "../source_jobs";

// Issue #579: a SourceJob execution hands off one enrichment. When it ends
// with other Sources still `processing` and awaiting enrichment, Convex chains
// a follow-up execution (one Run in flight per job) until none is left, within
// a bound. Stop ends the chain.

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

const INSTANCE = "openclaw-instance-chain";
const TEMPLATE = "sources-fixture";
const OWNER = { subject: "owner-chain" };
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
      jobId: "job-chain", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: TEMPLATE, status: "active",
    workspaceKey: "ws-chain", openclawAgentName: TEMPLATE,
  });
}

const getJob = async (t: Harness) => await t.run(async (ctx) => {
  const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).collect())[0]!;
  return { ...job, ...(job.runtime as Record<string, unknown>) };
});

async function tickNow(t: Harness) {
  await t.run(async (ctx) => {
    const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).first())!;
    await ctx.db.patch(job._id, { nextRunAt: NOW - 1 });
  });
  await t.mutation(internal.source_jobs.tick, {});
}

async function writeProcessingSource(t: Harness, n: number): Promise<Id<"sources">> {
  return await t.mutation(internal.sources.insert, {
    instanceId: INSTANCE, ownerId: OWNER.subject, templateId: TEMPLATE, sourceId: "reel",
    label: `Reel ${n}`, family: "social-video", status: "processing",
    origin: `https://example.com/r/${n}`, capturedAt: 1, marketing: {}, analysis: { hook: "shallow" },
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

async function runSession(t: Harness, outputs: unknown) {
  await t.action(internal.mission_dispatcher_node.tick, {});
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {});
  await drain(t, outputs);
  await t.action(internal.mission_dispatcher_node.tick, {});
}

const handoff = (sourceRef: string, jobId: string) => ({
  status: "in_progress",
  summary: "analysis started",
  reviewQuestions: [],
  job: { mcpServer: "analysis-mcp", jobId, jobType: "analyze", sourceRef },
});

const runs = async (t: Harness): Promise<Doc<"runs">[]> =>
  (await t.run((ctx) => ctx.db.query("runs").collect())).sort((a, b) => a._creationTime - b._creationTime);

function mockJobCompleted() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: "OK", headers: { get: () => "application/json" },
    json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify({ status: "completed", output: { deep: "x" } }) }], isError: false } }),
  }));
}

/** Hands off `source`, polls it to completion, completes it and ends the resumed execution. */
async function enrichOne(t: Harness, source: Id<"sources">, n: number) {
  await runSession(t, handoff(source, `job-${n}`));
  mockJobCompleted();
  await t.action(internal.mission_dispatcher_node.pollExternalJobs, {});
  await t.mutation(internal.sources.complete, {
    id: source, instanceId: INSTANCE, templateId: TEMPLATE, sourceId: "reel",
    origin: `https://example.com/r/${n}`, capturedAt: 1, marketing: {}, analysis: { hook: "deep" },
  });
  await runSession(t, { status: "success", summary: "completed" });
}

describe("SourceJob enrichment chain", () => {
  it("chains one execution per remaining processing Source, then succeeds", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await tickNow(t);
    const sources = [await writeProcessingSource(t, 1), await writeProcessingSource(t, 2), await writeProcessingSource(t, 3)];

    await enrichOne(t, sources[0], 1);
    let job = await getJob(t);
    expect(job.lastOutcome).toBeUndefined();
    let all = await runs(t);
    expect(all.at(-1)).toMatchObject({ status: "running", jobId: job._id });
    expect(job.inFlightRunId).toBe(all.at(-1)!._id);

    await enrichOne(t, sources[1], 2);
    job = await getJob(t);
    expect(job.lastOutcome).toBeUndefined();
    expect(job.inFlightRunId).toBeDefined();

    await enrichOne(t, sources[2], 3);
    job = await getJob(t);
    expect(job).toMatchObject({ lastOutcome: "succeeded", cursorAt: NOW });
    expect(job.inFlightRunId).toBeUndefined();
    all = await runs(t);
    expect(all.filter((r) => r.status === "pending" || r.status === "running")).toHaveLength(0);
    for (const id of sources) expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe("ready");
  });

  it("ends the job with a visible reason once the chain bound is reached", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await tickNow(t);
    await writeProcessingSource(t, 1);
    // The Agent ends every execution without handing off: the Source stays processing.
    for (let i = 0; i <= MAX_CHAINED_EXECUTIONS; i++) {
      await runSession(t, { status: "success", summary: "nothing done" });
    }
    const job = await getJob(t);
    expect(job.lastOutcome).toBe("failed");
    expect(job.lastError).toContain(String(MAX_CHAINED_EXECUTIONS));
    expect(job.inFlightRunId).toBeUndefined();
    expect(await runs(t)).toHaveLength(MAX_CHAINED_EXECUTIONS + 1);
  });

  it("stops the chain when a chained Run is cancelled", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await tickNow(t);
    await writeProcessingSource(t, 1);
    await runSession(t, { status: "success", summary: "nothing done" });
    const chained = (await runs(t)).at(-1)!;
    expect(chained.status).toBe("running");

    await t.mutation(internal.runs.markCancelled, { runId: chained._id });

    const job = await getJob(t);
    expect(job.lastOutcome).toBe("failed");
    expect(job.inFlightRunId).toBeUndefined();
    expect(await runs(t)).toHaveLength(2);
  });
});
