import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { RunResult } from "../run_result";
import { installTemplateRegistry, loadFixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// The auto-publish chain is triggered from `internal.runs.markCompleted` via
// `ctx.scheduler.runAfter(0, ...)`. convex-test only runs scheduled functions
// when timers are advanced explicitly, so every call to markCompleted in this
// file is paired with `flushScheduled` below (fake timers +
// `finishAllScheduledFunctions`), per the convex-test docs pattern for
// testing scheduled functions.
async function markCompletedAndFlush(
  t: ReturnType<typeof convexTest>,
  args: { runId: Id<"runs">; result: RunResult },
) {
  await t.mutation(internal.runs.markCompleted, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

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
  "../project_templates.ts": () => import("../project_templates.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-apc-1";

useTemplateRegistry([INSTANCE_ID], ["@opengroow/seo"]);
const TEMPLATE_ID = "@opengroow/seo";
/** Fixture template declaring `reject` before `approve` (both gated on to_validate). */
const REJECT_FIRST_TEMPLATE_ID = "seo-reject-first";
const OWNER_ID = "owner-apc-1";
const EXTERNAL_ID = "art-apc-1";

function mockFetchOkSequence(...bodies: Array<Record<string, unknown>>) {
  const fn = vi.fn();
  for (const body of bodies) {
    fn.mockResolvedValueOnce({ ok: true, json: async () => body });
  }
  vi.stubGlobal("fetch", fn);
}

function mockFetchApproveOkPublishFail(status = 500, statusText = "Internal Server Error") {
  const fn = vi.fn();
  fn.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  fn.mockResolvedValueOnce({ ok: false, status, statusText });
  vi.stubGlobal("fetch", fn);
}

function mockFetchFail(status = 500, statusText = "Internal Server Error") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status, statusText }),
  );
}

async function seedInstance(t: ReturnType<typeof convexTest>) {
  const isoNow = new Date().toISOString();
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: isoNow,
      openclawId: INSTANCE_ID,
      updatedAt: isoNow,
      userId: OWNER_ID,
    });
  });
}

async function seedProjectAgent(
  t: ReturnType<typeof convexTest>,
  templateId: string = TEMPLATE_ID,
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId,
      status: "active",
      mcpServerKeys: ["article-mcp"],
      config: { apiKey: "key-apc" },
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedMissionAndRun(
  t: ReturnType<typeof convexTest>,
  opts: { autoPublish?: boolean; templateId?: string } = {},
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  const now = Date.now();
  const templateId = opts.templateId ?? TEMPLATE_ID;
  return t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId,
      type: "create_article",
      payload: {},
      status: "doing",
      ...(opts.autoPublish !== undefined ? { autoPublish: opts.autoPublish } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      missionId,
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId,
      agentName: templateId,
      sessionKey: `mega-mission-${missionId}`,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    return { missionId, runId };
  });
}

const reviewResult: RunResult = {
  status: "needs_human_review",
  summary: "ask",
  reviewQuestions: ["q?"],
  artifact: {
    kind: "markdown",
    external: { service: "article-mcp", id: EXTERNAL_ID },
    metadata: {},
  },
};

const successResult: RunResult = { status: "success", summary: "ok" };

describe("auto-publish chain (issue #329)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("autoPublish:true + supported template + needs_human_review → mission done, approve then publish called in order", async () => {
    mockFetchOkSequence({}, { indexing: { status: "submitted", provider: "speedyindex", taskId: "t1" } });
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: true });

    await markCompletedAndFlush(t, { runId, result: reviewResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("done");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain(`/articles/${EXTERNAL_ID}/approve`);
    expect(fetchMock.mock.calls[1][0]).toContain(`/articles/${EXTERNAL_ID}/publish`);
  });

  it("approve effect fails → mission failed with message, publish never called", async () => {
    mockFetchFail(500, "Internal Server Error");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: true });

    await markCompletedAndFlush(t, { runId, result: reviewResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("failed");
    expect(mission?.errorMessage).toBeTruthy();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/approve");
  });

  it("publish effect fails after approve succeeded → mission failed, approve was not lost", async () => {
    mockFetchApproveOkPublishFail(500, "Internal Server Error");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: true });

    await markCompletedAndFlush(t, { runId, result: reviewResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("failed");
    expect(mission?.errorMessage).toBeTruthy();

    const events = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(events.some((e) => e.type === "ReviewApproved")).toBe(true);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("autoPublish:false → unchanged behavior, no fetch call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: false });

    await markCompletedAndFlush(t, { runId, result: reviewResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("to_validate");

    const events = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(events.some((e) => e.type === "ArticleToValidate")).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("autoPublish absent → unchanged behavior, no fetch call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, {});

    await markCompletedAndFlush(t, { runId, result: reviewResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("to_validate");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("autoPublish:true + needs_human_review but no artifact → mission stays to_validate for a human, no fetch call", async () => {
    // Regression: a Run can reach needs_human_review while only explaining
    // why it needs a human (e.g. every keyword candidate exhausted), without
    // ever producing an artifact — the schema allows it. Chaining
    // autoPublishChain here used to fail loudly at the approve step ("No
    // artifact available for this mission") and mark the Mission failed,
    // even though nothing was actually wrong: it should just wait for a
    // human like the autoPublish:false case does.
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: true });

    const noArtifactResult: RunResult = {
      status: "needs_human_review",
      summary: "every candidate keyword exhausted, nothing left to try",
      reviewQuestions: ["q?"],
    };
    await markCompletedAndFlush(t, { runId, result: noArtifactResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("to_validate");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("picks actions by capability key, not by requiredStatus — a template declaring reject before approve still approves", async () => {
    // `reject` is also gated on "to_validate": selecting the approve step by
    // status would fire the revision_run effect and re-dispatch a Run.
    const restoreRegistry = installTemplateRegistry([INSTANCE_ID], [loadFixtureTemplate(REJECT_FIRST_TEMPLATE_ID)]);
    try {
      mockFetchOkSequence({}, {});
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await seedProjectAgent(t, REJECT_FIRST_TEMPLATE_ID);
      const { missionId, runId } = await seedMissionAndRun(t, {
        autoPublish: true,
        templateId: REJECT_FIRST_TEMPLATE_ID,
      });

      await markCompletedAndFlush(t, { runId, result: reviewResult });

      const mission = await t.run(async (ctx) => ctx.db.get(missionId));
      expect(mission?.status).toBe("done");

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain(`/articles/${EXTERNAL_ID}/approve`);
      expect(fetchMock.mock.calls[1][0]).toContain(`/articles/${EXTERNAL_ID}/publish`);
    } finally {
      restoreRegistry();
    }
  });

  it("run ends success with autoPublish:true → unchanged, no fetch call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await seedProjectAgent(t);
    const { missionId, runId } = await seedMissionAndRun(t, { autoPublish: true });

    await markCompletedAndFlush(t, { runId, result: successResult });

    const mission = await t.run(async (ctx) => ctx.db.get(missionId));
    expect(mission?.status).toBe("done");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
