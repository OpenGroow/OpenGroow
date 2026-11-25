import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";
import { buildContentPlanningRunFile } from "../content_planning_dispatch";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation";

// Issue #176: what a content_planning Run returns becomes one draft Content Plan with its proposed Planned
// Contents, or fails the Run with a reason per faulty item (ADR-086).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../content_planning_jobs.ts": () => import("../content_planning_jobs.js"),
  "../content_planning_dispatch.ts": () => import("../content_planning_dispatch.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-cp-result";
const OTHER_INSTANCE = "instance-cp-other";
const TEMPLATE = "strategy-capable";
const PRODUCER = "producer-capable";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-cpr", subject: "owner-cpr" };
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);
const SUCCESS = { status: "success" as const, summary: "Content Plan received" };

const mission = (type: string, extra: Record<string, unknown> = {}) => ({ type, label: type, agentsMd: `${type}.md`, ...extra });
const producer = () => {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: {
      ...base.manifest, id: PRODUCER, jobTypes: [],
      missionTypes: [
        mission("make_video", { publish: { kind: "video" } }),
        mission("make_post", { publish: { kind: "image" } }),
        mission("make_carousel", { publish: { kind: "carousel" }, contextProviders: ["observation-production-source"] }),
        mission("make_tiktok", { publish: { kind: "video", platforms: ["tiktok"] } }),
        mission("research"),
      ],
    },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;
let jobId: Id<"jobs">;
let familyId: Id<"creativeFamilies">;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE), producer()]);
  t = convexTest(schema, modules);
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "provisioning", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
    }),
  );
  for (const templateId of [TEMPLATE, PRODUCER]) {
    await t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId, status: "active", workspaceKey: `ws-${templateId}`, openclawAgentName: templateId });
  }
  await t.run(async (ctx) => {
    await ctx.db.insert("publishers", {
      instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", updatedAt: NOW,
      targets: [{ target: "social:example", channelService: "instagram" }, { target: "blog:example" }],
    } as never);
    familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "f", name: "F", description: "d" });
  });
  jobId = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((job) => job.type === "content_planning")!._id;
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

const owner = () => t.withIdentity(OWNER);
const recipe = (missionType = "make_video", status: "active" | "archived" = "active", instanceId = INSTANCE) =>
  t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId, creativeFamilyId: familyId, templateId: PRODUCER, missionType, name: "R", description: "d", status } as never));
const source = (instanceId = INSTANCE) => t.run((ctx) => ctx.db.insert("sources", { instanceId, ownerId: OWNER.subject, templateId: PRODUCER, sourceId: "s", label: "S", family: "f", marketing: {}, status: "ready", origin: "example", capturedAt: NOW, createdAt: NOW, analysis: {} } as never));

const configure = (productionTargets: Array<{ kind: string; quantity: number; publishTargets: string[] }>) =>
  owner().mutation(api.content_planning_jobs.setConfig, { jobId, planningDays: 7, productionTargets });

/** A running Run of the Job, with its pins taken as dispatch takes them (period 2030-03-05 to 2030-03-11). */
async function startRun(targets = [{ kind: "video", quantity: 2, publishTargets: ["social:example"] }]) {
  await configure(targets);
  await owner().mutation(api.jobs.runNow, { jobId });
  await t.mutation(internal.content_planning_jobs.tick, {});
  const runId = ((await t.run((ctx) => ctx.db.get(jobId)))!.runtime as { inFlightRunId: Id<"runs"> }).inFlightRunId;
  await t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
  return runId;
}

const item = async (over: Record<string, unknown> = {}) => ({
  missionType: "make_video", recipeId: await recipe(), title: "A title", brief: "A brief", plannedAt: "2030-03-06", intent: "exploit", rationale: "Why", ...over,
});
const complete = (runId: Id<"runs">, contentPlanEnvelope: unknown) => t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS, contentPlanEnvelope });
const plans = () => t.run((ctx) => ctx.db.query("contentPlans").collect());
const contents = () => t.run((ctx) => ctx.db.query("plannedContents").collect());
const getRun = (id: Id<"runs">) => t.run((ctx) => ctx.db.get(id));
const getJob = () => t.run((ctx) => ctx.db.get(jobId));
const tableCounts = () => t.run(async (ctx) => ({
  missions: (await ctx.db.query("missions").collect()).length,
  publications: (await ctx.db.query("publications").collect()).length,
  recipes: (await ctx.db.query("productionRecipes").collect()).length,
  reviews: (await ctx.db.query("strategicReviews").collect()).length,
}));

describe("destinations", () => {
  it("refuses an item whose pinned channels were all removed since dispatch, and persists nothing", async () => {
    const runId = await startRun();
    await t.run(async (ctx) => {
      const publisher = (await ctx.db.query("publishers").collect())[0]!;
      await ctx.db.patch(publisher._id, { targets: [{ target: "blog:example" }] } as never);
    });
    await complete(runId, { rationale: "r", items: [await item()] });
    expect(await plans()).toHaveLength(0);
    expect(await contents()).toHaveLength(0);
    expect((await getRun(runId))!.errorMessage).toMatch(/no Publish target/);
  });
});

describe("a valid result", () => {
  it("creates one draft plan with proposed contents, fills publish targets and format, and settles the Job", async () => {
    const runId = await startRun();
    const run = await getRun(runId);
    const envelope = { rationale: "The plan", items: [await item(), await item({ title: "Second", plannedAt: "2030-03-11", intent: "explore", publishTargets: ["evil:x"] })] };
    const before = await tableCounts();
    await complete(runId, envelope);
    const [plan] = await plans();
    expect(plan).toMatchObject({ runId, instanceId: INSTANCE, ownerId: OWNER.subject, status: "draft", rationale: "The plan", periodStart: run!.contentPlanning!.periodStart, periodEnd: run!.contentPlanning!.periodEnd });
    const rows = await contents();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ planId: plan!._id, kind: "video", missionType: "make_video", status: "proposed", publishTargets: ["social:example"], title: "A title", intent: "exploit" });
    expect(rows[1]).toMatchObject({ publishTargets: ["social:example"], intent: "explore", plannedAt: "2030-03-11" });
    expect(await getRun(runId)).toMatchObject({ status: "completed" });
    const job = await getJob();
    expect(job).toMatchObject({ lastOutcome: "succeeded" });
    expect(job!.lastSummary).toMatch(/2 contents/);
    expect(job!.runtime).not.toHaveProperty("inFlightRunId");
    expect(await tableCounts()).toEqual(before);
  });

  it("persisting the same Run twice creates nothing twice", async () => {
    const runId = await startRun();
    const envelope = { rationale: "The plan", items: [await item()] };
    await complete(runId, envelope);
    expect(await complete(runId, envelope)).toEqual({ applied: false });
    expect(await plans()).toHaveLength(1);
    expect(await contents()).toHaveLength(1);
  });

  it("accepts a Publish target whose compatibility is uncertain", async () => {
    const runId = await startRun();
    await complete(runId, { rationale: "r", items: [await item()] });
    expect(await getRun(runId)).toMatchObject({ status: "completed" });
  });

  it("requires nothing of a Source when the Mission type does not need one, and accepts one of the Project", async () => {
    const runId = await startRun([{ kind: "carousel", quantity: 1, publishTargets: ["blog:example"] }]);
    await complete(runId, { rationale: "r", items: [await item({ missionType: "make_carousel", recipeId: await recipe("make_carousel"), sourceId: await source() })] });
    expect(await contents()).toMatchObject([{ kind: "carousel", sourceId: expect.any(String) }]);
  });
});

describe("an empty result", () => {
  it("completes the Run with the rationale in lastSummary and creates no plan; repeating changes nothing", async () => {
    const runId = await startRun();
    await complete(runId, { rationale: "Nothing worth planning this week", items: [] });
    expect(await getRun(runId)).toMatchObject({ status: "completed" });
    expect(await getJob()).toMatchObject({ lastOutcome: "succeeded", lastSummary: "Nothing worth planning this week" });
    expect((await getJob())!.runtime).not.toHaveProperty("inFlightRunId");
    expect(await complete(runId, { rationale: "other", items: [] })).toEqual({ applied: false });
    expect(await getJob()).toMatchObject({ lastSummary: "Nothing worth planning this week" });
    expect(await plans()).toHaveLength(0);
    expect(await contents()).toHaveLength(0);
  });
});

describe("a draft already exists", () => {
  it("refuses with draft_exists and creates nothing, even when the draft appeared after dispatch", async () => {
    const runId = await startRun();
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "a", sessionKey: "s", status: "completed", createdAt: NOW, updatedAt: NOW } as never);
      await ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE, runId: other, periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "r", status: "draft", createdAt: NOW });
    });
    await complete(runId, { rationale: "r", items: [await item()] });
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("draft_exists") });
    expect(await plans()).toHaveLength(1);
    expect(await contents()).toHaveLength(0);
    expect(await getJob()).toMatchObject({ lastOutcome: "failed" });
    expect((await getJob())!.runtime).not.toHaveProperty("inFlightRunId");
  });

  it("two Runs of one Project completing cannot produce two drafts", async () => {
    const first = await startRun();
    const second = await t.run(async (ctx) => {
      const run = (await ctx.db.get(first))!;
      const { _id, _creationTime, ...rest } = run;
      return ctx.db.insert("runs", { ...rest, sessionKey: "second" });
    });
    const envelope = { rationale: "r", items: [await item()] };
    await Promise.all([complete(first, envelope), complete(second, envelope).catch(() => undefined)]);
    expect(await plans()).toHaveLength(1);
  });
});

describe("an invalid result", () => {
  const fails = async (envelope: unknown, message: RegExp, targets?: Array<{ kind: string; quantity: number; publishTargets: string[] }>) => {
    const runId = await startRun(targets);
    await complete(runId, envelope);
    const run = await getRun(runId);
    expect(run).toMatchObject({ status: "failed" });
    expect(run!.errorMessage).toMatch(/invalid_result/);
    expect(run!.errorMessage).toMatch(message);
    expect(await plans()).toHaveLength(0);
    expect(await contents()).toHaveLength(0);
    // An invalid result is retried (see "retries"): the Job is not failed yet.
    expect((await getJob())!.lastOutcome).not.toBe("failed");
  };

  it("rejects a malformed result, naming each faulty item", async () => {
    await fails({ rationale: "r", items: [await item(), await item({ title: "" }), await item({ plannedAt: "2030-04-01" })] }, /items\[1\].*items\[2\]/);
  });
  it("rejects a result with no envelope", async () => {
    const runId = await startRun();
    await t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS });
    expect(await getRun(runId)).toMatchObject({ status: "failed" });
    expect(await plans()).toHaveLength(0);
  });
  it("rejects a Recipe of another Project", async () => {
    await fails({ rationale: "r", items: [await item({ recipeId: await recipe("make_video", "active", OTHER_INSTANCE) })] }, /items\[0\].*Recipe of this Project/);
  });
  it("rejects an unknown Recipe", async () => {
    await fails({ rationale: "r", items: [await item({ recipeId: "nope" })] }, /items\[0\].*Recipe of this Project/);
  });
  it("rejects an archived Recipe", async () => {
    await fails({ rationale: "r", items: [await item({ recipeId: await recipe("make_video", "archived") })] }, /archived/);
  });
  it("rejects a Recipe written for another Mission type", async () => {
    await fails({ rationale: "r", items: [await item({ missionType: "make_post" })] }, /Mission type "make_video"/);
  });
  it("rejects a Mission type whose Agent is not active", async () => {
    const runId = await startRun();
    await t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId: PRODUCER, status: "inactive", workspaceKey: `ws-${PRODUCER}`, openclawAgentName: PRODUCER });
    await complete(runId, { rationale: "r", items: [await item()] });
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("no active Agent") });
    expect(await plans()).toHaveLength(0);
  });
  it("rejects a format with no pinned target", async () => {
    await fails({ rationale: "r", items: [await item({ missionType: "make_post", recipeId: await recipe("make_post") })] }, /format "image" has no production target/);
  });
  it("rejects more contents of a format than remain", async () => {
    await fails({ rationale: "r", items: [await item(), await item(), await item()] }, /3 contents proposed but only 2 remain/);
  });
  it("rejects a missing Source where the Mission type needs one, and a Source of another Project", async () => {
    const targets = [{ kind: "carousel", quantity: 2, publishTargets: ["blog:example"] }];
    await fails({ rationale: "r", items: [await item({ missionType: "make_carousel", recipeId: await recipe("make_carousel") })] }, /needs a Source/, targets);
  });
  it("rejects a Source of another Project", async () => {
    const targets = [{ kind: "carousel", quantity: 2, publishTargets: ["blog:example"] }];
    await fails({ rationale: "r", items: [await item({ missionType: "make_carousel", recipeId: await recipe("make_carousel"), sourceId: await source(OTHER_INSTANCE) })] }, /Source of this Project/, targets);
  });
  it("rejects a pinned Publish target the Mission type cannot publish to (unsupported)", async () => {
    await fails({ rationale: "r", items: [await item({ missionType: "make_tiktok", recipeId: await recipe("make_tiktok") })] }, /items\[0\].*social:example/);
  });
});

describe("retries", () => {
  const runsOfJob = () => t.run((ctx) => ctx.db.query("runs").collect());
  const runtime = async () => (await getJob())!.runtime as { inFlightRunId?: Id<"runs">; inFlightTries?: number; inFlightErrors?: string[] };
  /** The Run now in flight, put in running state as dispatch does. */
  const inFlight = async () => {
    const id = (await runtime()).inFlightRunId!;
    await t.run((ctx) => ctx.db.patch(id, { status: "running" }));
    return id;
  };
  const bad = async (over: Record<string, unknown>) => ({ rationale: "r", items: [await item(), await item(over)] });

  it("retries an invalid result with the same pins and the reasons of each faulty item, even if the Job config changed", async () => {
    const first = await startRun();
    const pins = (await getRun(first))!.contentPlanning;
    await complete(first, await bad({ title: "" }));
    await configure([{ kind: "video", quantity: 5, publishTargets: ["blog:example"] }]);
    const retryId = (await runtime()).inFlightRunId!;
    expect(retryId).not.toBe(first);
    expect(await getRun(first)).toMatchObject({ status: "failed" });
    expect(await getRun(retryId)).toMatchObject({ status: "pending", resumedFromRunId: first, contentPlanning: pins });
    expect(await getJob()).not.toMatchObject({ lastOutcome: "failed" });
    const inputs = await t.query(internal.content_planning_dispatch.loadDispatchInputs, { runId: retryId });
    expect(inputs!.pins).toEqual(pins);
    expect(inputs!.feedback).toEqual([expect.stringMatching(/items\[1\]/)]);
    expect(inputs!.feedback![0]).not.toMatch(/items\[0\]/);
    const md = buildContentPlanningRunFile(inputs!.pins, inputs!.feedback);
    expect(md).toMatch(/Previous attempt feedback/);
    expect(md).toMatch(/items\[1\]/);
    expect(buildContentPlanningRunFile(pins!)).not.toMatch(/Previous attempt feedback/);
  });

  it("fails after 3 tries with the reasons in the Run errorMessage and the Job lastError", async () => {
    let id = await startRun();
    for (let i = 0; i < 3; i++) {
      await complete(id, await bad({ title: "" }));
      if (i < 2) id = await inFlight();
    }
    expect(await runsOfJob()).toHaveLength(3);
    expect(await getRun(id)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/invalid_result.*items\[1\]/) });
    const job = await getJob();
    expect(job).toMatchObject({ lastOutcome: "failed", lastError: expect.stringMatching(/invalid_result.*items\[1\]/) });
    expect(job!.runtime).not.toHaveProperty("inFlightRunId");
    expect(await plans()).toHaveLength(0);
  });

  it("a retry that succeeds settles the Job", async () => {
    const first = await startRun();
    await complete(first, await bad({ title: "" }));
    const second = await inFlight();
    await complete(second, { rationale: "r", items: [await item()] });
    expect(await getRun(second)).toMatchObject({ status: "completed" });
    expect(await getJob()).toMatchObject({ lastOutcome: "succeeded" });
    expect(await plans()).toHaveLength(1);
  });

  it("retries a result file that cannot be read when asked", async () => {
    const first = await startRun();
    await t.mutation(internal.runs.markFailed, { runId: first, code: "file_invalid", message: "bad json", retryWithFeedback: true });
    const retryId = (await runtime()).inFlightRunId!;
    expect(retryId).not.toBe(first);
    expect((await t.query(internal.content_planning_dispatch.loadDispatchInputs, { runId: retryId }))!.feedback).toEqual([expect.stringContaining("bad json")]);
  });

  it("never retries draft_exists", async () => {
    const runId = await startRun();
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "a", sessionKey: "s", status: "completed", createdAt: NOW, updatedAt: NOW } as never);
      await ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE, runId: other, periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "r", status: "draft", createdAt: NOW });
    });
    await complete(runId, { rationale: "r", items: [await item()] });
    expect(await runsOfJob()).toHaveLength(2);
    expect(await getJob()).toMatchObject({ lastOutcome: "failed", lastError: expect.stringContaining("draft_exists") });
  });

  it("never retries a plain failure or a cancellation", async () => {
    const runId = await startRun();
    await t.mutation(internal.runs.markFailed, { runId, code: "timeout", message: "late" });
    expect(await runsOfJob()).toHaveLength(1);
    expect(await getJob()).toMatchObject({ lastOutcome: "failed" });
  });

  it("a Job with no usable target starts no Run, so there is nothing to retry", async () => {
    await configure([]);
    await owner().mutation(api.jobs.runNow, { jobId });
    await t.mutation(internal.content_planning_jobs.tick, {});
    expect(await runsOfJob()).toHaveLength(0);
    expect(await getJob()).toMatchObject({ lastOutcome: "skipped" });
  });
});

describe("a failed Run", () => {
  it("leaves no plan and no Planned Content", async () => {
    const runId = await startRun();
    await t.mutation(internal.runs.markFailed, { runId, code: "timeout", message: "late" });
    expect(await plans()).toHaveLength(0);
    expect(await contents()).toHaveLength(0);
    expect(await getJob()).toMatchObject({ lastOutcome: "failed" });
  });
});

describe("reconciliation", () => {
  const snapshot = (content: string): ReconcileSnapshot => ({
    execResult: { ok: true }, resultReadCommandId: "c1" as Id<"commands">, readResult: { ok: true, data: { content, found: true } }, workspaceKey: "ws",
    timedOut: false, salvageTimedOut: false, finalReadCommandId: null, finalReadResult: null, maxMs: 1,
  });
  const ctx = { parent: { kind: "job", jobId: "j1" as Id<"jobs"> } as never, contentPlanning: true, runId: "run1" as Id<"runs">, missionType: "", retryableFailureCount: 0 };

  it("hands the result file's envelope over as it is, to be validated at persistence", () => {
    const body = { rationale: "r", items: [{ anything: 1 }] };
    expect(decideReconciliation(snapshot(JSON.stringify(body)), ctx)).toEqual({ type: "persistContentPlan", envelope: body });
  });
  it("an unparsable file fails the Run", () => {
    expect(decideReconciliation(snapshot("{nope"), ctx)).toMatchObject({ type: "markFailed", code: "file_invalid" });
  });
});
