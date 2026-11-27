import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";
import { listPlannedContents } from "../planning_reads";

// Issue #183: continuous Content Planning across consecutive Runs (ADR-086).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../content_plan_decision.ts": () => import("../content_plan_decision.js"),
  "../content_plan_edit.ts": () => import("../content_plan_edit.js"),
  "../content_planning_jobs.ts": () => import("../content_planning_jobs.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-cp-continuous";
const TEMPLATE = "strategy-capable";
const PRODUCER = "producer-capable";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-cpc", subject: "owner-cpc" };
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);
const SUCCESS = { status: "success" as const, summary: "Content Plan received" };

const mission = (type: string, extra: Record<string, unknown> = {}) => ({ type, label: type, agentsMd: `${type}.md`, kind: "creative", ...extra });
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
        mission("research", { kind: "operational" }),
      ],
    },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
const owner = () => t.withIdentity(OWNER);
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
  await owner().mutation(api.content_planning_jobs.setConfig, { jobId, planningDays: 7, productionTargets: [{ contentType: "video", quantity: 3, publishTargets: ["social:example"] }] });
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

const DAY = 86_400_000;
const recipe = () =>
  t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: INSTANCE, templateId: PRODUCER, missionType: "make_video", name: "R", description: "d" } as never));
const getJob = () => t.run((ctx) => ctx.db.get(jobId));
const runs = () => t.run((ctx) => ctx.db.query("runs").collect());
const contents = () => t.run((ctx) => ctx.db.query("plannedContents").collect());
const plans = () => t.run((ctx) => ctx.db.query("contentPlans").collect());
const at = (offsetDays: number) => vi.setSystemTime(NOW + offsetDays * DAY);

/** Run Now then the tick: starts a Run (marked running) or ends the pass without one. */
async function pass() {
  const before = (await runs()).length;
  await owner().mutation(api.jobs.runNow, { jobId });
  await t.mutation(internal.content_planning_jobs.tick, {});
  const all = await runs();
  if (all.length === before) return { runId: null, job: (await getJob())! };
  const runId = ((await getJob())!.runtime as { inFlightRunId: Id<"runs"> }).inFlightRunId;
  await t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
  return { runId, job: (await getJob())! };
}
const pinsOf = async (runId: Id<"runs">) => (await t.run((ctx) => ctx.db.get(runId)))!.contentPlanning!;

/** The Agent returns a plan of videos on the given dates; returns the draft plan. */
async function draft(runId: Id<"runs">, dates: string[]) {
  const recipeId = await recipe();
  const items = dates.map((plannedAt, i) => ({ missionType: "make_video", recipeId, title: `T${plannedAt}-${i}`, brief: "b", plannedAt, intent: "exploit", rationale: "w" }));
  await t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS, contentPlanEnvelope: { rationale: "plan", items } });
  return (await plans()).find((plan) => plan.runId === runId)!;
}
const approve = (planId: Id<"contentPlans">) => owner().mutation(api.content_plan_decision.approve, { planId });
const reject = (planId: Id<"contentPlans">) => owner().mutation(api.content_plan_decision.reject, { planId });


describe("two consecutive Runs", () => {
  it("count the approved contents of an overlapping Planning period and plan only what remains", async () => {
    const first = await pass();
    expect(await pinsOf(first.runId!)).toMatchObject({ periodStart: "2030-03-05", periodEnd: "2030-03-11", targets: [{ target: 3, existing: 0, remaining: 3 }] });
    const plan = await draft(first.runId!, ["2030-03-06", "2030-03-09", "2030-03-10"]);
    expect(await approve(plan._id)).toEqual({ ok: true });

    at(3);
    const second = await pass();
    // 2030-03-08 to 2030-03-14: the contents of the 9th and the 10th count, the one of the 6th does not.
    expect(await pinsOf(second.runId!)).toMatchObject({ periodStart: "2030-03-08", periodEnd: "2030-03-14", targets: [{ target: 3, existing: 2, remaining: 1 }] });
  });

  it("do not count rejected or removed contents", async () => {
    const first = await pass();
    const plan = await draft(first.runId!, ["2030-03-06", "2030-03-07", "2030-03-08"]);
    const removed = (await contents()).find((c) => c.plannedAt === "2030-03-08")!;
    await owner().mutation(api.content_plan_edit.remove, { contentId: removed._id });
    expect(await approve(plan._id)).toEqual({ ok: true });

    at(0);
    const second = await pass();
    expect(await pinsOf(second.runId!)).toMatchObject({ targets: [{ existing: 2, remaining: 1 }] });
    // A rejected plan counts for nothing.
    const other = await draft(second.runId!, ["2030-03-09"]);
    expect(await reject(other._id)).toEqual({ ok: true });
    const third = await pass();
    expect(await pinsOf(third.runId!)).toMatchObject({ targets: [{ existing: 2, remaining: 1 }] });
  });

  it("start no Run when the target is fully met", async () => {
    const first = await pass();
    const plan = await draft(first.runId!, ["2030-03-06", "2030-03-07", "2030-03-08"]);
    await approve(plan._id);
    const runCount = (await runs()).length;
    const second = await pass();
    expect(second.runId).toBeNull();
    expect(second.job).toMatchObject({ lastOutcome: "succeeded", lastSummary: "targets already met" });
    expect(await runs()).toHaveLength(runCount);
  });

  it("start no second Run while a draft is pending, then a new one after approval or rejection", async () => {
    const first = await pass();
    const plan = await draft(first.runId!, ["2030-03-06"]);
    const blocked = await pass();
    expect(blocked.runId).toBeNull();
    expect(blocked.job).toMatchObject({ lastOutcome: "skipped", lastSummary: "a draft Content Plan is waiting for review" });

    await reject(plan._id);
    const afterRejection = await pass();
    expect(afterRejection.runId).not.toBeNull();
    const second = await draft(afterRejection.runId!, ["2030-03-07"]);
    expect((await pass()).runId).toBeNull();

    await approve(second._id);
    const afterApproval = await pass();
    expect(afterApproval.runId).not.toBeNull();
    expect(await pinsOf(afterApproval.runId!)).toMatchObject({ targets: [{ existing: 1, remaining: 2 }] });
  });

  it("never touch the approved contents", async () => {
    const first = await pass();
    const plan = await draft(first.runId!, ["2030-03-06", "2030-03-09"]);
    await approve(plan._id);
    const approved = await contents();

    at(3);
    const second = await pass();
    const next = await draft(second.runId!, ["2030-03-12"]);
    await reject(next._id);
    await pass();

    const after = await contents();
    for (const content of approved) expect(after.find((c) => c._id === content._id)).toEqual(content);
    expect((await plans()).find((p) => p._id === plan._id)!.status).toBe("approved");
  });

  it("a second Run cannot plan more than what remains", async () => {
    const first = await pass();
    await approve((await draft(first.runId!, ["2030-03-06", "2030-03-07"]))._id);
    const second = await pass();
    const recipeId = await recipe();
    const items = [1, 2].map((i) => ({ missionType: "make_video", recipeId, title: `X${i}`, brief: "b", plannedAt: "2030-03-08", intent: "exploit", rationale: "w" }));
    await t.mutation(internal.runs.markCompleted, { runId: second.runId!, result: SUCCESS, contentPlanEnvelope: { rationale: "r", items } });
    expect((await plans()).filter((p) => p.runId === second.runId)).toHaveLength(0);
    expect((await runs()).filter((r) => r.resumedFromRunId === second.runId)).toHaveLength(1);
  });
});

describe("what the Agent reads", () => {
  it("shows the approved Planned Contents of the dates, not the rejected ones", async () => {
    const first = await pass();
    const plan = await draft(first.runId!, ["2030-03-06", "2030-03-09"]);
    const removed = (await contents()).find((c) => c.plannedAt === "2030-03-09")!;
    await owner().mutation(api.content_plan_edit.remove, { contentId: removed._id });
    await approve(plan._id);

    const read = (args: object) => t.run((ctx) => listPlannedContents(ctx, INSTANCE, args));
    const approved = await read({ from: "2030-03-05", to: "2030-03-11", status: "approved" });
    expect(approved.plannedContents.map((c) => [c.plannedAt, c.status])).toEqual([["2030-03-06", "approved"]]);
    expect((await read({ from: "2030-03-08", to: "2030-03-14", status: "approved" })).plannedContents).toEqual([]);
    expect((await read({ from: "2030-03-05", to: "2030-03-11" })).plannedContents.map((c) => c.status).sort()).toEqual(["approved", "rejected"]);
  });
});
