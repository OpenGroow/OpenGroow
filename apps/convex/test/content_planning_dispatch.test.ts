import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";
import { buildContentPlanningRunFile } from "../content_planning_dispatch";
import { appendContextProviders } from "../mission_dispatcher/context_providers";

// Issue #175: Planning period, remaining quantities and pinned dispatch (ADR-086).

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

const INSTANCE = "instance-cp-dispatch";
const TEMPLATE = "strategy-capable";
const PRODUCER = "producer-capable";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-cpd", subject: "owner-cpd" };
// A Monday, 2030-03-04 10:00 UTC: the period is 2030-03-05 to 2030-03-11 for 7 days.
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);
const DAY = 86_400_000;

const mission = (type: string, publish?: { kind: string }) => ({ type, label: type, agentsMd: `${type}.md`, ...(publish ? { publish } : {}) });
const producer = () => {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: { ...base.manifest, id: PRODUCER, jobTypes: [], missionTypes: [mission("make_video", { kind: "video" }), mission("make_post", { kind: "image" })] },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;

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
  await activate(TEMPLATE);
  await activate(PRODUCER);
  await t.run((ctx) => ctx.db.insert("publishers", { instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", targets: [{ target: "social:example" }, { target: "blog:example" }], updatedAt: NOW }));
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

const activate = (templateId: string) =>
  t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId, status: "active", workspaceKey: `ws-${templateId}`, openclawAgentName: templateId });
const owner = () => t.withIdentity(OWNER);
const planningJob = async () => (await t.run((ctx) => ctx.db.query("jobs").collect())).find((job) => job.type === "content_planning")!;
const reload = (jobId: Id<"jobs">) => t.run((ctx) => ctx.db.get(jobId));
const runs = () => t.run((ctx) => ctx.db.query("runs").collect());
const target = (kind: string, quantity: number, publishTargets = ["social:example"]) => ({ kind, quantity, publishTargets });
const configure = async (productionTargets: ReturnType<typeof target>[], planningDays = 7) => {
  const job = await planningJob();
  await owner().mutation(api.content_planning_jobs.setConfig, { jobId: job._id, planningDays, productionTargets });
  return job._id;
};
const tickNow = async (jobId: Id<"jobs">) => {
  await owner().mutation(api.jobs.runNow, { jobId });
  await t.mutation(internal.content_planning_jobs.tick, {});
  return (await reload(jobId))!;
};

const seedPlan = (status: "draft" | "approved" | "rejected") =>
  t.run(async (ctx) => {
    const jobId = (await ctx.db.query("jobs").collect()).find((job) => job.type === "content_planning")!._id;
    const runId = await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "a", sessionKey: "s", status: "completed", createdAt: NOW, updatedAt: NOW } as never);
    return ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE, runId, periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "r", status, createdAt: NOW });
  });
const seedContent = (planId: Id<"contentPlans">, kind: string, plannedAt: string, status: "proposed" | "approved" | "rejected") =>
  t.run(async (ctx) => {
    const creativeFamilyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: `f-${plannedAt}-${kind}-${status}`, name: "F", description: "d" });
    const recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId, templateId: PRODUCER, missionType: "make_video", name: "R", description: "d" } as never);
    return ctx.db.insert("plannedContents", {
      ownerId: OWNER.subject, instanceId: INSTANCE, planId, kind, missionType: "make_video", recipeId, publishTargets: ["social:example"],
      title: "T", brief: "B", plannedAt, intent: "explore", rationale: "r", status, createdAt: NOW,
    });
  });

describe("pre-dispatch skips", () => {
  it("skips while a draft Content Plan exists: no Run, summary set, next run advanced", async () => {
    const jobId = await configure([target("video", 3)]);
    await seedPlan("draft");
    const job = await tickNow(jobId);
    expect(job).toMatchObject({ lastOutcome: "skipped", state: "active" });
    expect(job.lastSummary).toMatch(/draft/i);
    expect(job.nextRunAt).toBeGreaterThan(NOW + 6 * DAY);
    expect(job.runNowAt).toBeUndefined();
    expect((await runs()).filter((r) => r.contentPlanning !== undefined)).toHaveLength(0);
  });

  it("an approved or rejected plan is not a draft", async () => {
    const jobId = await configure([target("video", 3)]);
    await seedPlan("approved");
    await seedPlan("rejected");
    expect((await tickNow(jobId)).lastOutcome).not.toBe("skipped");
    expect((await runs()).filter((r) => r.contentPlanning !== undefined)).toHaveLength(1);
  });

  it("succeeds without a Run when every target is already met by approved contents of the period", async () => {
    const jobId = await configure([target("video", 2), target("image", 1)]);
    const plan = await seedPlan("approved");
    await seedContent(plan, "video", "2030-03-05", "approved");
    await seedContent(plan, "video", "2030-03-11", "approved");
    await seedContent(plan, "image", "2030-03-08", "approved");
    const job = await tickNow(jobId);
    expect(job).toMatchObject({ lastOutcome: "succeeded", lastSummary: "targets already met" });
    expect(job.nextRunAt).toBeGreaterThan(NOW + 6 * DAY);
    expect((await runs()).filter((r) => r.contentPlanning !== undefined)).toHaveLength(0);
  });
});

describe("Run with pins", () => {
  it("counts only approved contents of the format dated in the period, from any plan", async () => {
    const jobId = await configure([target("video", 5, ["social:example", "blog:example"]), target("image", 2, ["blog:example"])]);
    const a = await seedPlan("approved");
    const b = await seedPlan("draft");
    await seedContent(a, "video", "2030-03-05", "approved");
    await seedContent(b, "video", "2030-03-11", "approved"); // another plan counts
    await seedContent(a, "video", "2030-03-04", "approved"); // before the period
    await seedContent(a, "video", "2030-03-12", "approved"); // after the period
    await seedContent(a, "video", "2030-03-07", "proposed");
    await seedContent(a, "video", "2030-03-07", "rejected");
    await seedContent(a, "image", "2030-03-07", "approved"); // another format
    // A Mission of the same format outside any plan does not count.
    await t.run((ctx) => ctx.db.insert("missions", { ownerId: OWNER.subject, instanceId: INSTANCE, templateId: PRODUCER, type: "make_video", status: "approved", payload: {}, createdAt: NOW, updatedAt: NOW } as never));
    // The draft makes the pass skip: take it out of the way.
    await t.run((ctx) => ctx.db.patch(b, { status: "approved" }));
    const job = await tickNow(jobId);
    const [run] = await runs().then((all) => all.filter((r) => r.contentPlanning !== undefined));
    expect(run).toMatchObject({ status: "pending", sessionKey: `mega-run-${run!._id}` });
    expect(run!.contentPlanning).toEqual({
      periodStart: "2030-03-05",
      periodEnd: "2030-03-11",
      targets: [
        { kind: "video", target: 5, existing: 2, remaining: 3, publishTargets: ["social:example", "blog:example"] },
        { kind: "image", target: 2, existing: 1, remaining: 1, publishTargets: ["blog:example"] },
      ],
      ignored: [],
    });
    expect(job.latestRunId).toBe(run!._id);
    expect(job.runtime).toMatchObject({ inFlightRunId: run!._id });
    expect(job.nextRunAt).toBeGreaterThan(NOW + 6 * DAY);
    expect(job.runNowAt).toBeUndefined();
  });

  it("keeps a format with nothing left to plan in the pins when another still has room", async () => {
    const jobId = await configure([target("video", 1), target("image", 2)]);
    await seedContent(await seedPlan("approved"), "video", "2030-03-06", "approved");
    await tickNow(jobId);
    const run = (await runs()).find((r) => r.contentPlanning !== undefined)!;
    expect(run.contentPlanning!.targets.map((x: { kind: string; remaining: number }) => [x.kind, x.remaining])).toEqual([["video", 0], ["image", 2]]);
  });

  it("uses the pinned period length, and a later config edit never changes the Run", async () => {
    const jobId = await configure([target("video", 3)], 3);
    await tickNow(jobId);
    const run = (await runs()).find((r) => r.contentPlanning !== undefined)!;
    expect(run.contentPlanning).toMatchObject({ periodStart: "2030-03-05", periodEnd: "2030-03-07" });
    await t.run((ctx) => ctx.db.patch(run._id, { status: "completed" }));
    await owner().mutation(api.content_planning_jobs.setConfig, { jobId, planningDays: 30, productionTargets: [target("video", 9)] });
    const after = await t.run((ctx) => ctx.db.get(run._id));
    expect(after!.contentPlanning).toEqual(run.contentPlanning);
  });

  it("ignores a vanished Publish target, reports it on the Run and leaves the stored config alone", async () => {
    const jobId = await configure([target("video", 3, ["social:example", "blog:example"])]);
    await t.run(async (ctx) => {
      const publisher = (await ctx.db.query("publishers").collect())[0]!;
      await ctx.db.patch(publisher._id, { targets: [{ target: "social:example" }] });
    });
    await tickNow(jobId);
    const run = (await runs()).find((r) => r.contentPlanning !== undefined)!;
    expect(run.contentPlanning!.targets[0]!.publishTargets).toEqual(["social:example"]);
    expect(run.contentPlanning!.ignored.join(" ")).toContain("blog:example");
    expect((await reload(jobId))!.config).toMatchObject({ productionTargets: [target("video", 3, ["social:example", "blog:example"])] });
  });

  it("blocks Run Now while a Run is in flight", async () => {
    const jobId = await configure([target("video", 3)]);
    await tickNow(jobId);
    await expect(owner().mutation(api.jobs.runNow, { jobId })).rejects.toThrow(/already running/);
  });

  it("dispatch inputs carry the Run's pins, and a failed Run ends the Job as failed", async () => {
    const jobId = await configure([target("video", 3)]);
    await tickNow(jobId);
    const run = (await runs()).find((r) => r.contentPlanning !== undefined)!;
    const inputs = await t.query(internal.content_planning_dispatch.loadDispatchInputs, { runId: run._id });
    expect(inputs).toMatchObject({ workspaceKey: `ws-${TEMPLATE}`, jobId, pins: run.contentPlanning });
    expect(await t.query(internal.content_planning_dispatch.isContentPlanningRun, { runId: run._id })).toBe(true);
    await t.run((ctx) => ctx.db.patch(run._id, { status: "running" }));
    await t.mutation(internal.runs.markFailed, { runId: run._id, code: "dispatch_failed", message: "boom" });
    expect(await reload(jobId)).toMatchObject({ lastOutcome: "failed", lastError: expect.stringContaining("boom") });
  });
});

describe("run.md", () => {
  const pins = {
    periodStart: "2030-03-05", periodEnd: "2030-03-11",
    targets: [{ kind: "video", target: 5, existing: 2, remaining: 3, publishTargets: ["social:example"] }],
    ignored: ["image: no longer produced"],
  };
  it("shows the period, per-format quantities and destinations, and what was ignored", () => {
    const md = buildContentPlanningRunFile(pins);
    expect(md).toContain("2030-03-05 to 2030-03-11");
    expect(md).toContain("| video | 5 | 2 | 3 | social:example |");
    expect(md).toContain("image: no longer produced");
    expect(md).toMatch(/jobs\/content-planning\.md/);
  });
  it("is a context provider named content-planning-targets", () => {
    expect(appendContextProviders("base", ["content-planning-targets"], { "content-planning-targets": pins })).toContain("| video | 5 | 2 | 3 | social:example |");
    expect(appendContextProviders("base", ["content-planning-targets"], { "content-planning-targets": null })).toBe("base");
  });
});
