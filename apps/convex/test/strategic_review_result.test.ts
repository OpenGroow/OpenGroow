import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { decideReconciliation, type ReconcileSnapshot } from "../mission_dispatcher/reconciliation";
import { readStrategicMemory } from "../strategic_reviews";
import { STRATEGIC_REVIEW_LIMITS } from "../strategic_review_rules";

// Issue #168: what a strategic_review Run returns becomes a Strategic Review
// (pinned period and base), or fails the Run with a readable reason (ADR-085).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../runs.ts": () => import("../runs.js"),
  "../strategic_reviews.ts": () => import("../strategic_reviews.js"),
  "../strategic_review_jobs.ts": () => import("../strategic_review_jobs.js"),
};

const INSTANCE = "instance-sr-result";
const TEMPLATE = "example-strategy";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-sr-result", subject: "owner-sr-result" };
const NOW = 1_900_000_000_000;
const DAY = 86_400_000;
const SUCCESS = { status: "success" as const, summary: "Strategic Review received" };

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

const envelope = (over: Record<string, unknown> = {}) => ({ report: "Report", consolidatedMemory: "Memory", references: { familyIds: [], recipeIds: [], publicationIds: [] }, ...over });

const insertJob = () =>
  t.run((ctx) => ctx.db.insert("jobs", {
    ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, type: "strategic_review", state: "active", config: { analysisDays: 10 }, runtime: {},
    unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW + DAY, createdAt: NOW, updatedAt: NOW,
  }));

/** A running Run of a strategic_review Job, started by Run Now (its pins are taken now). */
async function startRun(jobId: Id<"jobs">) {
  await t.withIdentity(OWNER).mutation(api.jobs.runNow, { jobId });
  await t.mutation(internal.strategic_review_jobs.tick, {});
  const job = await t.run((ctx) => ctx.db.get(jobId));
  const runId = (job!.runtime as { inFlightRunId: Id<"runs"> }).inFlightRunId;
  await t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
  return runId;
}

const complete = (runId: Id<"runs">, strategicReviewEnvelope: unknown) => t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS, strategicReviewEnvelope });
const reviews = () => t.run((ctx) => ctx.db.query("strategicReviews").collect());
const getRun = (id: Id<"runs">) => t.run((ctx) => ctx.db.get(id));
const getJob = (id: Id<"jobs">) => t.run((ctx) => ctx.db.get(id));
const runsOf = (jobId: Id<"jobs">) => t.run(async (ctx) => (await ctx.db.query("runs").collect()).filter((run) => (run as { jobId?: Id<"jobs"> }).jobId === jobId));

describe("strategic_review Run result: persistence", () => {
  it("a valid result becomes a Review with the pinned period and base, and the Job succeeds", async () => {
    const jobId = await insertJob();
    const runId = await startRun(jobId);
    const run = await getRun(runId);
    await complete(runId, envelope());
    const [review] = await reviews();
    expect(review).toMatchObject({ runId, instanceId: INSTANCE, report: "Report", consolidatedMemory: "Memory", ...run!.strategicReview });
    expect(await getRun(runId)).toMatchObject({ status: "completed" });
    expect(await getJob(jobId)).toMatchObject({ lastOutcome: "succeeded" });
    expect((await getJob(jobId))!.runtime).not.toHaveProperty("inFlightRunId");
  });

  it("ignores any identity, period or base the Agent puts in its result", async () => {
    const runId = await startRun(await insertJob());
    const run = await getRun(runId);
    await complete(runId, envelope({ runId: "x", periodStart: 1, periodEnd: 2, baseReviewId: "y" }));
    expect((await reviews())[0]).toMatchObject({ runId, periodStart: run!.strategicReview!.periodStart, periodEnd: run!.strategicReview!.periodEnd });
  });

  it("persisting the same Run again returns the same Review", async () => {
    const runId = await startRun(await insertJob());
    await complete(runId, envelope());
    const [first] = await reviews();
    const again = await t.mutation(internal.strategic_reviews.persist, {
      instanceId: INSTANCE, runId, periodStart: first.periodStart, periodEnd: first.periodEnd, envelope: envelope(),
    });
    expect(again).toMatchObject({ ok: true, reviewId: first._id, created: false });
    expect(await reviews()).toHaveLength(1);
  });

  it("an oversize, malformed, empty-report or badly referenced result fails the Run with the reason and changes nothing", async () => {
    const cases: [unknown, RegExp][] = [
      [envelope({ report: "a".repeat(STRATEGIC_REVIEW_LIMITS.reportChars + 1) }), /characters/],
      [envelope({ report: "  " }), /report/],
      ["not an envelope", /object/],
      [envelope({ references: { familyIds: ["not-an-id"] } }), /not-an-id/],
    ];
    for (const [bad, reason] of cases) {
      const runId = await startRun(await insertJob());
      await complete(runId, bad);
      expect(await getRun(runId)).toMatchObject({ status: "failed" });
      expect((await getRun(runId))!.errorMessage).toMatch(reason);
      expect(await reviews()).toHaveLength(0);
    }
  });

  it("an invalid result is retried with the same pins", async () => {
    const jobId = await insertJob();
    const first = await startRun(jobId);
    await complete(first, envelope({ report: "" }));
    const runs = await runsOf(jobId);
    expect(runs).toHaveLength(2);
    const retry = runs.find((r) => r._id !== first)!;
    expect(retry).toMatchObject({ status: "pending", resumedFromRunId: first });
    expect(retry.strategicReview).toEqual((await getRun(first))!.strategicReview);
  });

  it("a Run completed without a result envelope fails readably", async () => {
    const runId = await startRun(await insertJob());
    await t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS });
    expect(await getRun(runId)).toMatchObject({ status: "failed" });
    expect(await reviews()).toHaveLength(0);
  });
});

describe("strategic_review Run result: memory conflict", () => {
  it("fails the Run with a dedicated reason, no retry, no merge; the next Run starts from the newest memory", async () => {
    const jobId = await insertJob();
    const slow = await startRun(jobId);
    // Another Review lands while the Run was analyzing.
    const other = await t.run(async (ctx) => {
      const run = await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "a", sessionKey: "other", status: "completed", createdAt: NOW, updatedAt: NOW });
      return await ctx.db.insert("strategicReviews", {
        ownerId: OWNER.subject, instanceId: INSTANCE, runId: run, periodStart: 1, periodEnd: 2, report: "r", consolidatedMemory: "newer",
        references: { familyIds: [], recipeIds: [], publicationIds: [] }, memoryChanged: true, createdAt: NOW + 1,
      });
    });
    await complete(slow, envelope());
    expect(await reviews()).toHaveLength(1);
    const failed = await getRun(slow);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed!.errorMessage).toMatch(/memory_conflict/);
    expect(await runsOf(jobId)).toHaveLength(2); // the slow Run and the seeded one: no retry Run
    expect(await getJob(jobId)).toMatchObject({ lastOutcome: "failed" });

    const next = await startRun(jobId);
    expect((await getRun(next))!.strategicReview!.baseReviewId).toBe(other);
  });

  it("two overlapping Runs: the first persists, the second is rejected as a conflict", async () => {
    const jobId = await insertJob();
    const first = await startRun(jobId);
    const second = await t.run(async (ctx) => {
      const run = await ctx.db.get(first);
      return await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "a", sessionKey: "second", status: "running", strategicReview: run!.strategicReview, createdAt: NOW, updatedAt: NOW });
    });
    await complete(first, envelope());
    await t.run((ctx) => ctx.db.patch(jobId, { runtime: { inFlightRunId: second, inFlightTries: 0 } }));
    await complete(second, envelope({ report: "Second" }));
    expect((await reviews()).map((r) => r.report)).toEqual(["Report"]);
    expect((await getRun(second))!.errorMessage).toMatch(/memory_conflict/);
  });
});

describe("strategic_review Run result: get_strategic_memory", () => {
  const addReview = (createdAt: number, memory: string) =>
    t.run(async (ctx) => {
      const jobId = await ctx.db.insert("jobs", {
        ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "x", type: "custom", state: "active", config: {}, runtime: {},
        unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt, updatedAt: createdAt,
      });
      const run = await ctx.db.insert("runs", { jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "x", agentName: "a", sessionKey: `s-${createdAt}`, status: "completed", createdAt, updatedAt: createdAt });
      return await ctx.db.insert("strategicReviews", {
        ownerId: OWNER.subject, instanceId: INSTANCE, runId: run, periodStart: 1, periodEnd: 2, report: "r", consolidatedMemory: memory,
        references: { familyIds: [], recipeIds: [], publicationIds: [] }, memoryChanged: true, createdAt,
      });
    });
  const read = () => t.run((ctx) => readStrategicMemory(ctx, { instanceId: INSTANCE, templateId: TEMPLATE }));

  it("serves the pinned base to a strategic_review Run even when a newer Review exists, and the latest to others", async () => {
    const base = await addReview(NOW - DAY, "base memory");
    const jobId = await insertJob();
    const runId = await startRun(jobId);
    await addReview(NOW + 1, "newer memory");
    expect(await read()).toMatchObject({ exists: true, reviewId: base, memory: "base memory" });
    await t.run((ctx) => ctx.db.patch(runId, { status: "completed" }));
    expect(await read()).toMatchObject({ exists: true, memory: "newer memory" });
  });

  it("serves no memory to a Run pinned without a base, even if a Review appeared since", async () => {
    await startRun(await insertJob());
    await addReview(NOW + 1, "newer memory");
    expect(await read()).toMatchObject({ exists: false });
  });
});

describe("strategic_review Run result: reconciliation", () => {
  const snapshot = (content: string): ReconcileSnapshot => ({
    execResult: { ok: true }, resultReadCommandId: "c1" as Id<"commands">, readResult: { ok: true, data: { content, found: true } }, workspaceKey: "ws",
    timedOut: false, salvageTimedOut: false, finalReadCommandId: null, finalReadResult: null, maxMs: 1,
  });
  const ctx = { parent: { kind: "job", jobId: "j1" as Id<"jobs"> } as never, strategicReview: true, runId: "run1" as Id<"runs">, missionType: "", retryableFailureCount: 0 };

  it("hands the result file's envelope over as it is, to be validated at persistence", () => {
    const body = envelope({ references: { familyIds: ["x"] } });
    expect(decideReconciliation(snapshot(JSON.stringify(body)), ctx)).toEqual({ type: "persistStrategicReview", envelope: body });
  });

  it("an unparsable file fails the Run, to be retried with the error", () => {
    expect(decideReconciliation(snapshot("{nope"), ctx)).toMatchObject({ type: "markFailed", code: "file_invalid", retryWithFeedback: true });
  });
});
