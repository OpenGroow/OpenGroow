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
import { MAX_SOURCES_PER_RESULT } from "../source_jobs/limits";

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

const INSTANCE = "openclaw-instance-ing";
const TEMPLATE = "sources-fixture";
const OWNER = "owner-ing";
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

async function getJob(t: Harness) {
  return await t.run(async (ctx) => {
    const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).collect())[0]!;
    return { ...job, ...(job.runtime as Record<string, unknown>) };
  });
}
const allSources = (t: Harness) => t.run((ctx) => ctx.db.query("sources").collect());
const jobRuns = (t: Harness) =>
  t.run(async (ctx) => (await ctx.db.query("runs").collect()).filter((r) => r.missionId === undefined));

/** Fakes the runtime: the exec succeeds, and the result file read returns `outputs`. */
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

async function prepareJob(t: Harness) {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "job-ing", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER,
    }),
  );
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws-ing", openclawAgentName: TEMPLATE,
  });
  const job = await getJob(t);
  await t.run((ctx) => ctx.db.patch(job._id, {
    nextRunAt: NOW - 1,
    runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: OLD_CURSOR },
  }));
  await t.mutation(internal.source_jobs.tick, {});
}

async function runJob(t: Harness, outputs: unknown) {
  await prepareJob(t);
  // Until the job settles: an invalid result resumes the Agent (#567) up to the
  // bound. A chained follow-up (#579, Sources awaiting enrichment) is out of scope here.
  for (let i = 0; i < 6; i++) {
    const job = await getJob(t);
    if (!job.inFlightRunId || job.inFlightChained !== undefined) break;
    await t.action(internal.mission_dispatcher_node.tick, {}); // dispatch
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {}); // exec ok -> enqueue read
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {}); // read ok -> terminal
  }
}

const keyword = (overrides: Record<string, unknown> = {}) => ({
  templateId: TEMPLATE,
  sourceId: "keyword",
  common: { origin: "https://example.com/serp", capturedAt: 1_700_000_000_000, marketing: { topics: ["Running"] } },
  analysis: { query: "running shoes", volume: 900 },
  ...overrides,
});
const reel = () => ({
  templateId: TEMPLATE,
  sourceId: "reel",
  common: { origin: "https://example.com/reel/1", capturedAt: 1_700_000_000_000, marketing: { topics: ["Video"] } },
  analysis: { hook: "Watch this" },
});
const success = (sources: unknown[]) => ({ status: "success", summary: "ok", sources });

describe("SourceJob ingestion of the result file's Sources (#564)", () => {
  it("inserts declared Sources with label, family, status and the Run/SourceJob provenance from the Run", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword(), reel()]));

    const job = await getJob(t);
    const [run] = await jobRuns(t);
    const sources = await allSources(t);
    expect(sources).toHaveLength(2);
    expect(sources.find((s) => s.sourceId === "keyword")).toMatchObject({
      label: "Search keyword", family: "search", status: "ready", instanceId: INSTANCE,
      ownerId: OWNER, runId: run._id, sourceJobId: job._id,
    });
    // `reel` declares an enrichment: the write is only its first phase.
    expect(sources.find((s) => s.sourceId === "reel")).toMatchObject({
      label: "Video post", family: "social-video", status: "processing", runId: run._id, sourceJobId: job._id,
    });
    // ...so the job goes on with a follow-up execution for it (#579).
    expect(job.inFlightRunId).toBeDefined();
    expect(job.inFlightChained).toBe(1);
  });

  it("rejects an undeclared Source id and a Source of another Template; the valid Source stays and the job fails with every error", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword(), keyword({ sourceId: "nope" }), keyword({ templateId: "@opengroow/seo" })]));

    expect((await allSources(t)).map((s) => s.sourceId)).toEqual(["keyword"]);
    const job = await getJob(t);
    expect(job).toMatchObject({ lastOutcome: "failed", cursorAt: OLD_CURSOR });
    expect(job.lastError).toContain("sources[1]");
    expect(job.lastError).toContain('does not declare Source "nope"');
    expect(job.lastError).toContain("sources[2]");
    expect(job.lastError).toContain("templateId");
    expect(job.inFlightRunId).toBeUndefined();
  });

  it.each(["ownerId", "instanceId", "label", "family", "status", "runId", "sourceJobId", "score"])(
    "rejects a Source that sets %s",
    async (field) => {
      const t = convexTest(schema, modules);
      await runJob(t, success([keyword({ [field]: "x" })]));
      expect(await allSources(t)).toHaveLength(0);
      expect((await getJob(t)).lastError).toContain(`${field}: not allowed`);
    },
  );

  it("stores the optional raw capture and normalizes the topics", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword({ common: { ...keyword().common, raw: "full transcript" } })]));
    const [source] = await allSources(t);
    expect(source).toMatchObject({ raw: "full transcript", marketing: { topics: ["running"] } });
  });

  it("rejects a raw capture above 64 KB with its path and stores nothing", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword({ common: { ...keyword().common, raw: "x".repeat(65537) } })]));
    expect(await allSources(t)).toHaveLength(0);
    expect((await getJob(t)).lastError).toContain("common.raw");
  });

  it("reports an out-of-schema Source with the complete list of its errors", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword({ common: { origin: "", capturedAt: "x", marketing: {} }, analysis: { volume: -1 } })]));
    expect(await allSources(t)).toHaveLength(0);
    const error = (await getJob(t)).lastError ?? "";
    expect(error).toContain("common.origin");
    expect(error).toContain("common.capturedAt");
    expect(error).toContain("analysis");
  });

  it("rejects a completion whose Source id differs from the processing Source's", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.sources.insert, {
      instanceId: INSTANCE, ownerId: OWNER, templateId: TEMPLATE, sourceId: "reel",
      label: "Video post", family: "social-video", status: "processing",
      origin: "https://example.com/reel/1", capturedAt: 1, marketing: {}, analysis: { hook: "shallow" },
    });
    await runJob(t, success([keyword({ id })]));
    const sources = await allSources(t);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ _id: id, status: "processing" });
    expect((await getJob(t)).lastOutcome).toBe("failed");
  });

  it("completes a processing Source named by `id` instead of appending a new one", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.sources.insert, {
      instanceId: INSTANCE, ownerId: OWNER, templateId: TEMPLATE, sourceId: "reel",
      label: "Video post", family: "social-video", status: "processing",
      origin: "https://example.com/reel/1", capturedAt: 1, marketing: {}, analysis: { hook: "shallow" },
    });
    await runJob(t, success([{ ...reel(), id, analysis: { hook: "Watch this, deeply analyzed" } }]));

    const sources = await allSources(t);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ _id: id, status: "ready", analysis: { hook: "Watch this, deeply analyzed" } });
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded" });
  });

  it("rejects an id that names no Source of this Agent", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, success([keyword({ id: "nope" })]));
    expect(await allSources(t)).toHaveLength(0);
    expect((await getJob(t)).lastError).toContain("id:");
  });

  it("settles the job as failed with the Agent's explanation on a failed result", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, { status: "failed", summary: "analysis-mcp is down", error: { code: "mcp_down", message: "no route" } });
    expect(await allSources(t)).toHaveLength(0);
    const job = await getJob(t);
    expect(job.lastOutcome).toBe("failed");
    expect(job.lastError).toContain("analysis-mcp is down");
  });

  it("inserts nothing for a cancelled Run", async () => {
    const t = convexTest(schema, modules);
    await prepareJob(t);
    const [run] = await jobRuns(t);
    await t.run((ctx) => ctx.db.patch(run._id, { status: "cancelled" }));
    const res = await t.mutation(internal.runs.markCompleted, {
      runId: run._id,
      result: { status: "success", summary: "ok" },
      sources: [keyword()],
    });
    expect(res.applied).toBe(false);
    expect(await allSources(t)).toHaveLength(0);
  });

  it("inserts up to the cap and leaves the surplus to the next execution by keeping the cursor", async () => {
    const t = convexTest(schema, modules);
    const many = Array.from({ length: MAX_SOURCES_PER_RESULT + 3 }, (_, i) =>
      keyword({ common: { origin: `https://example.com/${i}`, capturedAt: 1, marketing: { topics: [] } } }),
    );
    await runJob(t, success(many));

    expect(await allSources(t)).toHaveLength(MAX_SOURCES_PER_RESULT);
    expect(await getJob(t)).toMatchObject({ lastOutcome: "succeeded", cursorAt: OLD_CURSOR });
  });

  it("tells the Agent, in the run file, the success shape with its sources", async () => {
    const t = convexTest(schema, modules);
    await prepareJob(t);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const payloads = (await t.run((ctx) => ctx.db.query("commands").collect())).map(
      (c) => c.payload as { filesToWrite?: Array<{ filePath: string; content: string }> },
    );
    const runMd = payloads.find((p) => p.filesToWrite)!.filesToWrite!.find((f) => f.filePath.endsWith("run.md"))!.content;
    expect(runMd).toContain('"sources"');
    expect(runMd).toContain(String(MAX_SOURCES_PER_RESULT));
  });
});
