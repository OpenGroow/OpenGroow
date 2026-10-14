import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { useTemplateRegistry } from "./helpers/template_registry.helpers";
import type { Doc, Id } from "../_generated/dataModel";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instance_ownership.ts": () => import("../instance_ownership.js"),
  "../missions.ts": () => import("../missions.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
  "../source_agent.ts": () => import("../source_agent.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../source_scoring.ts": () => import("../source_scoring.js"),
};

const INSTANCE = "score-job-instance";

useTemplateRegistry([INSTANCE], ["@opengroow/source"]);
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-score", subject: "owner-score" };
const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

async function seedInstance(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) => insertInstance(ctx, {
    jobId: "job-score", status: "running", runtimeStatus: "linked", runtimeReady: true,
    createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
  }));
}

async function activateSourceAgent(t: ReturnType<typeof convexTest>, status: "active" | "inactive" = "active") {
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE, templateId: "@opengroow/source", status, workspaceKey: "source-workspace", openclawAgentName: "source",
  });
}

async function insertSource(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{ status: "processing" | "ready" | "failed" | "unavailable"; marketing: { summary?: string; topics?: string[] }; excluded: boolean; scoring: Record<string, number> }> = {},
): Promise<Id<"sources">> {
  return await t.run((ctx) => ctx.db.insert("sources", {
    instanceId: INSTANCE, ownerId: OWNER.subject, templateId: "@opengroow/source", sourceId: "fixture",
    label: "Fixture source", family: "fixture", status: overrides.status ?? "ready", origin: "https://example.com",
    capturedAt: NOW, createdAt: NOW, marketing: overrides.marketing ?? { summary: "A useful marketing angle" }, analysis: { hook: "A hook" },
    ...(overrides.excluded !== undefined ? { excluded: overrides.excluded } : {}),
    ...(overrides.scoring !== undefined ? { scoring: overrides.scoring } : {}),
  }));
}

async function scoreJob(t: ReturnType<typeof convexTest>): Promise<Doc<"jobs"> | null> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("jobs").collect();
    return rows.find((row) => row.instanceId === INSTANCE && row.type === "source_scoring" && row.templateId === "@opengroow/source") as Doc<"jobs"> | undefined ?? null;
  });
}

describe("periodic Source scoring Job", () => {
  it("provisions one generic source_scoring Job when the Source Agent activates", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateSourceAgent(t);
    expect(await scoreJob(t)).toMatchObject({ instanceId: INSTANCE, type: "source_scoring", templateId: "@opengroow/source", state: "active", unit: "daily", hour: 6, minute: 0 });
  });

  it("lists the generic Job when the Project stores the owner token identifier", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await t.run((ctx) => ctx.db.query("projects").withIndex("by_project_id", (q) => q.eq("projectId", INSTANCE)).unique().then((project) => ctx.db.patch(project!._id, { ownerId: OWNER.tokenIdentifier })));
    await activateSourceAgent(t);
    const jobs = await t.withIdentity(OWNER).query(api.score_jobs.listByInstance, { instanceId: INSTANCE });
    expect(jobs.map((job) => job.agentName)).toEqual(["Source scoring"]);
  });

  it("Run Now creates at most one generic Job Run for the complete eligible batch", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateSourceAgent(t);
    const eligible = await insertSource(t);
    await insertSource(t, { status: "processing" });
    await insertSource(t, { status: "failed" });
    await insertSource(t, { excluded: true });
    await insertSource(t, { scoring: { productFit: 1 } });
    await insertSource(t, { marketing: {} });
    const job = (await scoreJob(t))!;
    expect(await t.withIdentity(OWNER).mutation(api.score_jobs.runNow, { jobId: job._id })).toBe(1);
    const result = await t.run(async (ctx) => ({ missions: await ctx.db.query("missions").collect(), runs: await ctx.db.query("runs").collect(), source: await ctx.db.get(eligible), job: await ctx.db.get(job._id) }));
    expect(result.missions).toHaveLength(0);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ jobId: job._id, templateId: "@opengroow/source", status: "pending" });
    expect((result.job?.runtime as { inFlightBatch?: { sourceIds: string[] } }).inFlightBatch?.sourceIds).toHaveLength(1);
    expect(result.source?.scoreMissionId).toBeUndefined();
  });

  it("pause prevents the scheduled pass and resume restores it", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateSourceAgent(t);
    await insertSource(t);
    const job = (await scoreJob(t))!;
    await t.withIdentity(OWNER).mutation(api.score_jobs.pause, { jobId: job._id });
    await t.mutation(internal.score_jobs.tick, {});
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);
    await t.withIdentity(OWNER).mutation(api.score_jobs.resume, { jobId: job._id });
    await t.withIdentity(OWNER).mutation(api.score_jobs.runNow, { jobId: job._id });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(1);
  });

  it("consumes a queued manual pass when the Source Agent is inactive", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateSourceAgent(t);
    await insertSource(t);
    const job = (await scoreJob(t))!;
    await t.run((ctx) => ctx.db.patch(job._id, {
      state: "paused",
      nextRunAt: NOW,
      runNowAt: NOW,
      runtime: { runNowRequestedAt: NOW, runNowRestorePaused: true },
    }));
    await activateSourceAgent(t, "inactive");

    await expect(t.mutation(internal.score_jobs.tick, {})).resolves.not.toThrow();
    const after = await t.run((ctx) => ctx.db.get(job._id));
    expect(after?.state).toBe("paused");
    expect(after).not.toHaveProperty("runNowAt");
    expect(after?.lastOutcome).toBe("failed");
    expect(after?.runtime).not.toHaveProperty("runNowRequestedAt");
  });

  it("keeps valid scores, retries only invalid entries, and settles without Partial", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateSourceAgent(t);
    const first = await insertSource(t);
    const second = await insertSource(t);
    const job = (await scoreJob(t))!;
    await t.withIdentity(OWNER).mutation(api.score_jobs.runNow, { jobId: job._id });
    const run = (await t.run((ctx) => ctx.db.query("runs").unique()))!;
    await t.run((ctx) => ctx.db.patch(run._id, { status: "running" }));
    await t.mutation(internal.runs.markCompleted, {
      runId: run._id,
      result: {
        status: "success", summary: "one valid",
        additionalDetails: { scores: [{ sourceId: first, productFit: 1, replicability: 0.75, creativeStrength: 0.5, creativeFamily: { slug: "mini_story", name: "Mini Story", description: "A short story." } }] },
      },
    });
    const afterFirst = await t.run(async (ctx) => ({ first: await ctx.db.get(first), second: await ctx.db.get(second), runs: await ctx.db.query("runs").collect(), job: await ctx.db.get(job._id) }));
    expect(afterFirst.first?.scoring).toMatchObject({ productFit: 1 });
    expect(afterFirst.second?.scoring).toBeUndefined();
    expect(afterFirst.runs).toHaveLength(2);
    expect((afterFirst.job?.runtime as { inFlightBatch?: { sourceIds: string[] } }).inFlightBatch?.sourceIds).toEqual([second]);
    expect(afterFirst.job?.lastOutcome).toBeUndefined();
  });
});
