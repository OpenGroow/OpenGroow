import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { appendContextProviders } from "../mission_dispatcher/context_providers";
import { buildStrategicReviewRunFile } from "../strategic_review_jobs";

// Issue #166: the strategic_review Job type, its configuration and the pins
// taken when a Run starts (ADR-085).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../runs.ts": () => import("../runs.js"),
  "../strategic_reviews.ts": () => import("../strategic_reviews.js"),
  "../strategic_review_jobs.ts": () => import("../strategic_review_jobs.js"),
};

const INSTANCE = "instance-sr-job";
const TEMPLATE = "example-strategy";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-sr", subject: "owner-sr" };
const NOW = 1_900_000_000_000;
const DAY = 86_400_000;

type T = ReturnType<typeof convexTest>;
let t: T;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "provisioning", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE, templateId: TEMPLATE, workspaceKey: "ws-sr", openclawAgentName: "strategy", status: "active",
      mcpServerKeys: [], createdAt: NOW, updatedAt: NOW,
    });
  });
});
afterEach(() => {
  vi.useRealTimers();
});

const insertJob = (config: unknown = { analysisDays: 30 }) =>
  t.run((ctx) => ctx.db.insert("jobs", {
    ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, type: "strategic_review", state: "active", config, runtime: {},
    unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW + DAY, createdAt: NOW, updatedAt: NOW,
  }));

const insertReview = (createdAt: number) =>
  t.run(async (ctx) => {
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "other", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt: NOW, updatedAt: NOW,
    });
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "other", agentName: "a", sessionKey: `s-${createdAt}`,
      status: "completed", createdAt, updatedAt: createdAt,
    });
    return await ctx.db.insert("strategicReviews", {
      ownerId: OWNER.subject, instanceId: INSTANCE, runId, periodStart: 1, periodEnd: 2, report: "r", consolidatedMemory: "m",
      references: { familyIds: [], recipeIds: [], publicationIds: [] }, memoryChanged: true, createdAt,
    });
  });

const runsOf = (jobId: Id<"jobs">) => t.run(async (ctx) => (await ctx.db.query("runs").collect()).filter((run) => (run as { jobId?: Id<"jobs"> }).jobId === jobId));
const runNow = (jobId: Id<"jobs">) => t.withIdentity(OWNER).mutation(api.jobs.runNow, { jobId });
const runNowAndTick = async (jobId: Id<"jobs">) => {
  await runNow(jobId);
  await t.mutation(internal.strategic_review_jobs.tick, {});
};

describe("strategic_review Job: analysisDays", () => {
  it("defaults to 30 days when the config has none", async () => {
    const jobId = await insertJob({});
    await runNowAndTick(jobId);
    const [run] = await runsOf(jobId);
    expect(run.strategicReview).toMatchObject({ periodStart: NOW - 30 * DAY, periodEnd: NOW });
  });

  it("accepts an integer from 1 to 365 on write and rejects anything else", async () => {
    const jobId = await insertJob();
    const set = (analysisDays: number) => t.withIdentity(OWNER).mutation(api.strategic_review_jobs.setAnalysisDays, { jobId, analysisDays });
    await set(1);
    await set(365);
    for (const bad of [0, 366, 1.5, -3, Number.NaN]) await expect(set(bad)).rejects.toThrow(/analysisDays/);
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.config).toEqual({ analysisDays: 365 });
  });
});

describe("strategic_review Job: pins at dispatch", () => {
  it("Run Now resolves the period from analysisDays (end = dispatch time) and pins no base before any Review", async () => {
    const jobId = await insertJob({ analysisDays: 7 });
    await runNowAndTick(jobId);
    const runs = await runsOf(jobId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "pending", templateId: TEMPLATE, agentName: "strategy" });
    expect(runs[0].strategicReview).toEqual({ periodStart: NOW - 7 * DAY, periodEnd: NOW });
  });

  it("pins the Project's latest Review as the base", async () => {
    const jobId = await insertJob();
    await insertReview(NOW - 5 * DAY);
    const latest = await insertReview(NOW - DAY);
    await runNowAndTick(jobId);
    const [run] = await runsOf(jobId);
    expect(run.strategicReview?.baseReviewId).toBe(latest);
  });

  it("runs on the Job's recurrence too, and never twice while a Run is in flight", async () => {
    const jobId = await insertJob();
    await t.run((ctx) => ctx.db.patch(jobId, { nextRunAt: NOW - 1 }));
    await t.mutation(internal.strategic_review_jobs.tick, {});
    await t.run((ctx) => ctx.db.patch(jobId, { nextRunAt: NOW - 1 }));
    await t.mutation(internal.strategic_review_jobs.tick, {});
    expect(await runsOf(jobId)).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(jobId)))!.nextRunAt).toBeGreaterThan(NOW);
  });

  it("creates no Mission and no Production Recipe", async () => {
    const jobId = await insertJob();
    await runNowAndTick(jobId);
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("productionRecipes").collect())).toHaveLength(0);
  });

  it("records a failure instead of a Run when the Agent is not active", async () => {
    const jobId = await insertJob();
    await t.run(async (ctx) => {
      const agent = await ctx.db.query("projectAgents").first();
      await ctx.db.patch(agent!._id, { status: "inactive" });
    });
    await runNowAndTick(jobId);
    expect(await runsOf(jobId)).toHaveLength(0);
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({ lastOutcome: "failed" });
    expect(job).not.toHaveProperty("runNowAt");
  });

  it("a retried Run keeps the original pins, and the dispatch reads them from the Run", async () => {
    const jobId = await insertJob({ analysisDays: 10 });
    const base = await insertReview(NOW - DAY);
    await runNowAndTick(jobId);
    const [first] = await runsOf(jobId);
    const pins = { periodStart: NOW - 10 * DAY, periodEnd: NOW, baseReviewId: base };
    expect(first.strategicReview).toEqual(pins);

    // Time moves on and a newer Review lands: the retry must not re-pin.
    vi.setSystemTime(NOW + 3 * DAY);
    await insertReview(NOW + 2 * DAY);
    await t.run((ctx) => ctx.db.patch(first._id, { status: "running" }));
    await t.mutation(internal.runs.markFailed, { runId: first._id, code: "file_invalid", message: "bad", retryWithFeedback: true });

    const retry = (await runsOf(jobId)).find((r) => r._id !== first._id)!;
    expect(retry).toMatchObject({ status: "pending", resumedFromRunId: first._id });
    expect(retry.strategicReview).toEqual(pins);
    const inputs = await t.query(internal.strategic_review_jobs.loadDispatchInputs, { runId: retry._id });
    expect(inputs?.pins).toEqual(pins);
    expect(inputs?.workspaceKey).toBe("ws-sr");
  });
});

describe("strategic_review Job: context", () => {
  const pins = { periodStart: Date.UTC(2026, 9, 1), periodEnd: Date.UTC(2026, 9, 31, 12) };

  it("gives the period and the instruction to pass it as from/to to every analytics call", () => {
    const md = buildStrategicReviewRunFile(pins);
    expect(md).toContain("2026-10-01T00:00:00.000Z");
    expect(md).toContain("2026-10-31T12:00:00.000Z");
    expect(md).toContain(String(pins.periodStart));
    expect(md).toContain(String(pins.periodEnd));
    expect(md).toMatch(/every analytics call/i);
    expect(md).toMatch(/`from`.*`to`/s);
  });

  it("is a context provider named strategic-review-period", () => {
    const md = appendContextProviders("base", ["strategic-review-period"], { "strategic-review-period": pins });
    expect(md).toContain("2026-10-01T00:00:00.000Z");
    expect(appendContextProviders("base", ["strategic-review-period"], { "strategic-review-period": null })).toBe("base");
  });
});

describe("strategic_review Job: Jobs page", () => {
  it("lists after the Source Jobs, labelled, and Run Now works", async () => {
    const jobId = await insertJob();
    await t.run((ctx) => ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, type: "source_scoring", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt: NOW, updatedAt: NOW,
    }));
    const jobs = await t.withIdentity(OWNER).query(api.jobs.listByInstance, { instanceId: INSTANCE });
    expect(jobs.map((j: { type: string }) => j.type)).toEqual(["source_scoring", "strategic_review"]);
    expect(jobs[1]).toMatchObject({ _id: jobId, label: "Strategic review", config: { analysisDays: 30 } });
    await expect(runNow(jobId)).resolves.toEqual({ status: "queued" });
  });
});
