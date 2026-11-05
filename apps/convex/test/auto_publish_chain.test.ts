import { insertInstance } from "./instance_fixture";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { RunResult } from "../run_result";
import { fixtureTemplate, installTemplateRegistry, loadFixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

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
  "../publications.ts": () => import("../publications.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_templates.ts": () => import("../project_templates.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
};

const INSTANCE_ID = "openclaw-instance-apc-1";

const IMAGE_TEMPLATE_ID = "@test/auto-image";
const imageTemplate = fixtureTemplate(IMAGE_TEMPLATE_ID, {
  missionTypes: [
    {
      type: "make_image",
      publish: { kind: "image" },
      review: {
        kind: "image",
        service: "workspace",
        actions: [
          { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
          { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
        ],
      },
    },
  ],
} as never);
useTemplateRegistry([INSTANCE_ID], ["@opengroow/seo", imageTemplate]);
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
  opts: { autoPublish?: boolean; templateId?: string; type?: string; payload?: Record<string, unknown> } = {},
): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  const now = Date.now();
  const templateId = opts.templateId ?? TEMPLATE_ID;
  return t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER_ID,
      instanceId: INSTANCE_ID,
      templateId,
      type: opts.type ?? "create_article",
      payload: opts.payload ?? {},
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

  describe("through the Publisher (issue #21)", () => {
    const OWNER = { name: "O", email: "o@e.com", tokenIdentifier: "test|apc", subject: OWNER_ID };
    const imageResult: RunResult = {
      status: "needs_human_review",
      summary: "ready",
      reviewQuestions: [],
      artifact: {
        kind: "image",
        external: { service: "media", id: "42" },
        metadata: {},
        publishable: { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hi" },
      },
    } as never;

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    function stubPostiz() {
      const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
        const path = String(url).replace("https://postiz.example.com/api/public/v1/", "");
        if (path === "integrations") return json([{ id: "ch-1", name: "IG", identifier: "instagram" }]);
        if (path === "upload-from-url") return json({ id: "m1", path: "https://postiz.example.com/u/1" });
        if (path === "posts" && init?.method === "POST") return json([{ postId: "post-1", integration: "ch-1" }]);
        return json({ error: "unexpected " + path }, 404);
      });
      vi.stubGlobal("fetch", fn);
      return fn;
    }
    async function setup(opts: { map: boolean; payload?: Record<string, unknown> }) {
      const t = convexTest(schema, modules);
      await seedInstance(t);
      await seedProjectAgent(t, IMAGE_TEMPLATE_ID);
      const owner = t.withIdentity(OWNER);
      await owner.mutation(api.publishers.save, {
        instanceId: INSTANCE_ID,
        adapter: "postiz",
        url: "https://postiz.example.com",
        apiKey: "secret",
      });
      if (opts.map) {
        await owner.mutation(api.publishers.addChannel, {
          instanceId: INSTANCE_ID,
          channelId: "ch-1",
          channelName: "My IG",
          channelService: "instagram",
        });
      } else {
        // A legacy entry without a channel.
        await t.run(async (ctx) => {
        const row = await ctx.db.query("publishers").first();
        await ctx.db.patch(row!._id, { targets: [{ target: "instagram" }] });
      });
      }
      const ids = await seedMissionAndRun(t, {
        autoPublish: true,
        templateId: IMAGE_TEMPLATE_ID,
        type: "make_image",
        payload: opts.payload ?? { publishTargets: ["instagram"] },
      });
      return { t, owner, ...ids };
    }
    const postBody = (fn: ReturnType<typeof stubPostiz>) => {
      const call = fn.mock.calls.find(([u]) => String(u).endsWith("/posts"));
      return JSON.parse(String((call![1] as RequestInit).body));
    };

    it("publishes at approval with no click and completes the Mission", async () => {
      const postiz = stubPostiz();
      const { t, owner, missionId, runId } = await setup({ map: true });
      await markCompletedAndFlush(t, { runId, result: imageResult });
      expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
      expect(await owner.query(api.publications.listForMission, { missionId })).toMatchObject([
        { target: "instagram", status: "published", externalId: "post-1" },
      ]);
      expect(postBody(postiz).type).toBe("now");
    });

    it("honors the publishAt carried by the Schedule payload: the Publication is scheduled", async () => {
      const postiz = stubPostiz();
      const publishAt = Date.now() + 3_600_000;
      const { t, owner, missionId, runId } = await setup({ map: true, payload: { publishTargets: ["instagram"], publishAt } });
      await markCompletedAndFlush(t, { runId, result: imageResult });

      expect(await owner.query(api.publications.listForMission, { missionId })).toMatchObject([
        { target: "instagram", status: "scheduled", scheduledAt: publishAt },
      ]);
      expect(postBody(postiz).type).toBe("schedule");
      expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");
    });

    it("a second attempt on an already failed Publication keeps the latest error", async () => {
      stubPostiz();
      const { t, owner, missionId, runId } = await setup({ map: false });
      await markCompletedAndFlush(t, { runId, result: imageResult });
      const [first] = await owner.query(api.publications.listForMission, { missionId });
      await t.mutation(internal.publications.recordFailure, {
        missionId,
        error: "A newer error",
      });
      const rows = await owner.query(api.publications.listForMission, { missionId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.id, status: "failed", error: "A newer error" });
    });

    it("a Schedule payload naming a channel that is not on the Publisher records a failed Publication instead of publishing", async () => {
      const postiz = stubPostiz();
      const { t, owner, missionId, runId } = await setup({ map: true, payload: { publishTargets: ["tiktok"] } });
      await markCompletedAndFlush(t, { runId, result: imageResult });
      const mission = await owner.query(api.missions.get, { missionId });
      expect(mission?.status).toBe("approved");
      const [failed] = await owner.query(api.publications.listForMission, { missionId });
      expect(failed).toMatchObject({ target: "tiktok", status: "failed" });
      expect(failed.error).toMatch(/Unknown channel "tiktok"/);
      expect(postiz).not.toHaveBeenCalled();
    });

    it("no channel chosen: the Mission fails with an explicit message and nothing is published", async () => {
      const postiz = stubPostiz();
      const { t, owner, missionId, runId } = await setup({ map: true, payload: {} });
      await markCompletedAndFlush(t, { runId, result: imageResult });
      const mission = await owner.query(api.missions.get, { missionId });
      expect(mission?.status).toBe("failed");
      expect(mission?.errorMessage).toMatch(/Choose a channel/);
      expect(postiz).not.toHaveBeenCalled();
    });

    it("unmapped target: Mission stays approved with a failed Publication, retryable once the Publisher is fixed", async () => {
      const postiz = stubPostiz();
      const { t, owner, missionId, runId } = await setup({ map: false });
      await markCompletedAndFlush(t, { runId, result: imageResult });

      const mission = await owner.query(api.missions.get, { missionId });
      expect(mission?.status).toBe("approved");
      expect(mission?.errorMessage).toBeUndefined();
      const [failed] = await owner.query(api.publications.listForMission, { missionId });
      expect(failed).toMatchObject({ target: "instagram", status: "failed" });
      expect(failed.error).toContain("not configured");
      expect(postiz).not.toHaveBeenCalled();

      await t.run(async (ctx) => {
        const row = await ctx.db.query("publishers").first();
        await ctx.db.patch(row!._id, {
          targets: [{ target: "instagram", channelId: "ch-1", channelName: "My IG", channelService: "instagram" }],
        });
      });
      await owner.action(api.publisher_node.retryPublication, { publicationId: failed.id });

      expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
      expect(await owner.query(api.publications.listForMission, { missionId })).toMatchObject([
        { status: "published" },
      ]);
    });
  });
});
