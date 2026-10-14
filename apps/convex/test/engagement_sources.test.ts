import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  buildRuntimeResultEventId,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
} from "@opengroow/protocol";
import { internal } from "../_generated/api";
import schema from "../schema";
import { useTemplateRegistry } from "./helpers/template_registry.helpers";

process.env.DASHBOARD_URL = "http://localhost:3001";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
process.env.BROKER_URL = "http://localhost:4000";
process.env.BROKER_KEY_ID = "test-broker-key";
process.env.BROKER_SECRET = "test-broker-secret";
process.env.OPENCLAW_CONTROL_URL = "http://localhost:4001";
process.env.OPENCLAW_CONTROL_KEY_ID = "test-control-key";
process.env.OPENCLAW_CONTROL_SECRET = "test-control-secret";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../mission_dispatcher.ts": () => import("../mission_dispatcher.js"),
  "../mission_dispatcher_node.ts": () => import("../mission_dispatcher_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../runs.ts": () => import("../runs.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../source_schema.ts": () => import("../source_schema.js"),
  "../sources.ts": () => import("../sources.js"),
};

const INSTANCE = "instance-se";
const OWNER = "owner-se";
const TEMPLATE = "@opengroow/engagement";

useTemplateRegistry([INSTANCE], [TEMPLATE]);
const NOW = 1_800_000_000_000;

type Harness = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function seedInstance(t: Harness) {
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "job-se",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: new Date().toISOString(),
      openclawId: INSTANCE,
      updatedAt: new Date().toISOString(),
      userId: OWNER,
    }),
  );
}

async function activate(t: Harness) {
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE,
    templateId: TEMPLATE,
    status: "active",
    workspaceKey: "ws-se",
    openclawAgentName: TEMPLATE,
  });
}

async function getIngestionJob(t: Harness) {
  return await t.run(async (ctx) => {
    const job = (await ctx.db.query("jobs").filter((q) => q.eq(q.field("type"), "source_ingestion")).unique())!;
    return { ...job, ...(job.runtime as Record<string, unknown>) };
  });
}

function videoPostPayload(overrides: Record<string, unknown> = {}) {
  return {
    templateId: TEMPLATE,
    sourceId: "video-post",
    common: {
      origin: "https://example.com/videos/abc123",
      capturedAt: 1_799_999_000_000,
      marketing: { summary: "A photographer explains street framing", topics: ["Street_Photography"] },
    },
    analysis: {
      postUrl: "https://example.com/videos/abc123",
      accountHandle: "jeanphoto75",
      caption: "Framing tips",
      hashtags: ["#streetphotography"],
      decision: "liked",
      likeCount: 11400,
      commentCount: 212,
      creativeFeatures: { mediaType: "video", format: "vertical_short_form", duration: 18, hasTextOverlay: true, facecam: false },
      hook: "Opens on a rain-soaked crosswalk",
      pacing: "fast cuts every 2s",
      narrativeStructure: "problem, tip, result",
      payoff: "the final framed shot",
      cta: "follow for more",
      transcriptRef: "enrich-run-1",
      frameRefs: ["frame-0", "frame-1"],
    },
    ...overrides,
  };
}

function imagePostPayload() {
  return {
    templateId: TEMPLATE,
    sourceId: "image-post",
    common: {
      origin: "https://example.com/images/7301",
      capturedAt: 1_799_999_500_000,
      marketing: { topics: ["Paris"] },
    },
    analysis: {
      postUrl: "https://example.com/images/7301",
      accountHandle: "paris_walks",
      decision: "commented",
      viewCount: 90000,
      creativeFeatures: { mediaType: "video", facecam: true },
    },
  };
}

describe("engagement Sources through SourceJob ingestion", () => {
  it("writes video-post and image-post Sources with the declared ids, label, family, common layers and analysis", async () => {
    const t = convexTest(schema, modules);
    await runJob(t, { status: "success", summary: "ok", sources: [videoPostPayload(), imagePostPayload()] });

    const rows = await t.run((ctx) => ctx.db.query("sources").collect());
    const byId = Object.fromEntries(rows.map((r) => [r.sourceId, r]));
    expect(Object.keys(byId).sort()).toEqual(["image-post", "video-post"]);
    expect(byId["video-post"]).toMatchObject({
      label: "Video post",
      family: "social-video",
      // Its video analysis is an enrichment phase (#533): processing until completed.
      status: "processing",
      origin: "https://example.com/videos/abc123",
      capturedAt: 1_799_999_000_000,
      marketing: { topics: ["street_photography"] },
      analysis: { hook: "Opens on a rain-soaked crosswalk", likeCount: 11400, transcriptRef: "enrich-run-1" },
    });
    expect(byId["image-post"]).toMatchObject({
      label: "Image post",
      status: "ready",
      family: "social-video",
      origin: "https://example.com/images/7301",
      analysis: { viewCount: 90000, creativeFeatures: { facecam: true } },
    });
  });

  it("reports a malformed entry with every error, writes nothing and fails the job with them", async () => {
    const t = convexTest(schema, modules);
    const bad = videoPostPayload({
      analysis: { accountHandle: "x", decision: "maybe", likeCount: "many", creativeFeatures: { mediaType: "photo" } },
    });
    await runJob(t, { status: "success", summary: "ok", sources: [bad] });

    const error = (await getIngestionJob(t)).lastError ?? "";
    expect(error).toContain("postUrl");
    expect(error).toContain("decision");
    expect(error).toContain("likeCount");
    expect(error).toContain("creativeFeatures.mediaType");
    expect(await t.run((ctx) => ctx.db.query("sources").collect())).toHaveLength(0);
  });
});

// The fake runtime: the exec succeeds and the RunResult read returns `outputs`.
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

async function runJob(t: Harness, outputs: unknown) {
  await seedInstance(t);
  await activate(t);
  const job = await getIngestionJob(t);
  await t.run((ctx) => ctx.db.patch(job._id, {
    nextRunAt: NOW - 1,
    runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1000 },
  }));
  await t.mutation(internal.source_jobs.tick, {});
  // Until the job settles: an invalid result resumes the Agent up to the bound.
  for (let i = 0; i < 6 && (await getIngestionJob(t)).inFlightRunId; i++) {
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
  }
}

describe("engagement SourceJob", () => {
  it("dispatches with both Sources' schemas and instruction files, and a non-engage Run in the batch does not fail the job", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = await getIngestionJob(t);
    await t.run((ctx) => ctx.db.patch(job._id, {
      nextRunAt: NOW - 1,
      runtime: { ...(job.runtime as Record<string, unknown>), cursorAt: 1000 },
    }));
    const scoringRun = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER, instanceId: INSTANCE, templateId: TEMPLATE, type: "some-other-mission-type", payload: {},
        status: "done", createdAt: 1, updatedAt: 1,
      });
      return await ctx.db.insert("runs", {
        missionId, ownerId: OWNER, instanceId: INSTANCE, templateId: TEMPLATE, agentName: TEMPLATE,
        sessionKey: "k", status: "completed", completedAt: 2000, createdAt: 1, updatedAt: 1,
      });
    });

    await t.mutation(internal.source_jobs.tick, {});
    await t.action(internal.mission_dispatcher_node.tick, {});
    const exec = (await t.run((ctx) => ctx.db.query("commands").collect())).find((c) => c.type === RUNTIME_OPENCLAW_EXEC)!;
    const files = (exec.payload as { filesToWrite: { filePath: string; content: string }[] }).filesToWrite;
    const context = files.map((f) => f.content).join("\n");
    expect(context).toContain('"video-post"');
    expect(context).toContain('"image-post"');
    expect(context).toContain(scoringRun);
    expect(context).toContain('"hook"');

    const outputs = { status: "success", summary: "Nothing to write: no engage Run in the batch." };
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
    await drain(t, outputs);
    await t.action(internal.mission_dispatcher_node.tick, {});
    const after = await getIngestionJob(t);
    expect(after.lastOutcome).toBe("succeeded");
  });
});
