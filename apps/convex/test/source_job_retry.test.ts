import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { join } from "node:path";
import { internal } from "../_generated/api";
import schema from "../schema";
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

const INSTANCE = "openclaw-instance-retry";
const TEMPLATE = "sources-fixture";
const OWNER = "owner-retry";
const NOW = 1_800_000_000_000;
const OLD_CURSOR = 1000;

type Harness = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
});
afterEach(() => {
  vi.useRealTimers();
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
      jobId: "job-retry", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws-retry", openclawAgentName: TEMPLATE,
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

const runMdOf = async (t: Harness, runId: string) => {
  const commands = await t.run((ctx) => ctx.db.query("commands").collect());
  const payloads = commands.map(
    (c) => c.payload as { outputsFilePath?: string; filesToWrite?: Array<{ filePath: string; content: string }> },
  );
  return payloads
    .find((p) => p.outputsFilePath?.includes(runId))!
    .filesToWrite!.find((f) => f.filePath.endsWith("run.md"))!.content;
};

const keyword = (origin = "https://example.com/serp") => ({
  templateId: TEMPLATE,
  sourceId: "keyword",
  common: { origin, capturedAt: 1_700_000_000_000, marketing: { topics: ["Running"] } },
  analysis: { query: "running shoes", volume: 900 },
});
const bad = (origin = "https://example.com/bad") => ({ ...keyword(origin), sourceId: "nope" });
const success = (sources: unknown[]) => ({ status: "success", summary: "ok", sources });

describe("SourceJob: invalid Sources resume the Agent with the errors (#567)", () => {
  it("keeps the valid Sources and resumes with the errors; only the corrected entry is then expected and inserted", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [
      success([keyword("https://example.com/a"), bad("https://example.com/b")]),
      success([keyword("https://example.com/b")]),
    ]);

    const [first, second] = await jobRuns(t);
    expect(await jobRuns(t)).toHaveLength(2);
    expect(second.resumedFromRunId).toBe(first._id);
    expect((await allSources(t)).map((s) => s.origin).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded", cursorAt: NOW });

    const runMd = await runMdOf(t, second._id);
    expect(runMd).toContain("sources[1] (https://example.com/b)");
    expect(runMd).toContain('does not declare Source "nope"');
    expect(runMd).toMatch(/only the failed entries/i);
  });

  it("does not duplicate a Source already inserted when the Agent resends it with the corrected entry", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [
      success([keyword("https://example.com/a"), bad("https://example.com/b")]),
      success([keyword("https://example.com/a"), keyword("https://example.com/b")]),
    ]);
    expect((await allSources(t)).map((s) => s.origin).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded" });
  });

  it("ends Failed after 3 tries with the complete errors visible, the valid Source inserted once", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [success([keyword(), bad()])]);

    expect(await jobRuns(t)).toHaveLength(3);
    const job = await getJob(t);
    expect(job).toMatchObject({ lastOutcome: "failed", cursorAt: OLD_CURSOR });
    expect(job.lastError).toContain("sources[1] (https://example.com/bad)");
    expect(job.lastError).toContain('does not declare Source "nope"');
    expect(job.inFlightRunId).toBeUndefined();
    expect(await allSources(t)).toHaveLength(1);
  });

  it("follows the same resume-then-succeed path for an unexpected result file", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [{ status: "blocked", summary: "no" }, success([keyword()])]);

    const [first, second] = await jobRuns(t);
    expect(second.resumedFromRunId).toBe(first._id);
    expect(await runMdOf(t, second._id)).toContain("expected format");
    expect(await allSources(t)).toHaveLength(1);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded" });
  });

  it("follows the same resume-then-fail path for an unreadable result file", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, ["not json {"]);

    expect(await jobRuns(t)).toHaveLength(3);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "failed" });
    expect(await allSources(t)).toHaveLength(0);
  });

  it("does not resume a failure the Agent reported itself", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, [{ status: "failed", summary: "mcp down", error: { code: "x", message: "y" } }]);
    expect(await jobRuns(t)).toHaveLength(1);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "failed" });
  });
});
