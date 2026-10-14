import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-jobs";
const TEMPLATE = "job-capable";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner", subject: "owner" };
const NOW = 1_900_000_000_000;

let restoreRegistry: () => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [loadFixtureTemplate(TEMPLATE)]);
});

afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

async function seedInstance(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) =>
    insertInstance(ctx, {
      jobId: "provisioning-job",
      status: "running",
      runtimeStatus: "linked",
      runtimeReady: true,
      createdAt: new Date(NOW).toISOString(),
      openclawId: INSTANCE,
      updatedAt: new Date(NOW).toISOString(),
      userId: OWNER.subject,
    }),
  );
}

async function activate(t: ReturnType<typeof convexTest>, status: "active" | "inactive" = "active") {
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE,
    templateId: TEMPLATE,
    status,
    workspaceKey: "workspace-jobs",
    openclawAgentName: TEMPLATE,
  });
}

async function rows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).filter((job) => job.instanceId === INSTANCE && job.templateId === TEMPLATE));
}

describe("generic Jobs", () => {
  it("provisions one stable Job per explicit capability with the default recurrence", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);

    expect(await rows(t)).toMatchObject([
      { type: "source_ingestion", state: "active", unit: "daily", hour: 6, minute: 0, timezone: "UTC", config: {}, runtime: {} },
      { type: "source_scoring", state: "active", unit: "daily", hour: 6, minute: 0, timezone: "UTC", config: {}, runtime: {} },
      { type: "source_routing", state: "active", unit: "daily", hour: 6, minute: 0, timezone: "UTC", config: {}, runtime: {} },
    ]);
  });

  it("makes activation idempotent and does not implicitly resume a paused Job", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const first = await rows(t);
    expect(first).toHaveLength(3);

    await activate(t);
    expect(await rows(t)).toHaveLength(3);
    await activate(t, "inactive");
    expect((await rows(t)).every((job) => job.state === "paused")).toBe(true);
    await activate(t);
    expect((await rows(t)).every((job) => job.state === "paused")).toBe(true);
  });

  it("supports ownership-scoped pause, resume, recurrence and Run Now controls", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const job = (await rows(t)).find((row) => row.type === "source_scoring")!;

    await t.withIdentity(OWNER).mutation(api.jobs.setFrequency, {
      jobId: job._id,
      frequency: { unit: "weekly", dayOfWeek: 2, hour: 8, minute: 30 },
      timezone: "Europe/Paris",
    });
    await t.withIdentity(OWNER).mutation(api.jobs.pause, { jobId: job._id });
    await t.withIdentity(OWNER).mutation(api.jobs.resume, { jobId: job._id });
    const result = await t.withIdentity(OWNER).mutation(api.jobs.runNow, { jobId: job._id });

    expect(result).toEqual({ status: "queued" });
    expect(await t.withIdentity(OWNER).query(api.jobs.listByInstance, { instanceId: INSTANCE })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "source_scoring", unit: "weekly", dayOfWeek: 2, hour: 8, minute: 30, timezone: "Europe/Paris", state: "active" }),
      ]),
    );
    expect(await t.run((ctx) => ctx.db.get(job._id))).toMatchObject({ state: "active", runtime: { runNowRestorePaused: false } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.withIdentity(OWNER).mutation(api.jobs.pause, { jobId: job._id });
    await t.withIdentity(OWNER).mutation(api.jobs.runNow, { jobId: job._id });
    const pausedRunNow = await t.run((ctx) => ctx.db.get(job._id));
    expect(pausedRunNow).toMatchObject({ state: "paused", runtime: { runNowRequestedAt: expect.any(Number), runNowRestorePaused: true } });

    await t.withIdentity(OWNER).mutation(api.jobs.resume, { jobId: job._id });
    const resumedQueued = await t.run((ctx) => ctx.db.get(job._id));
    expect(resumedQueued).toMatchObject({ state: "active", runNowAt: expect.any(Number), runtime: { runNowRequestedAt: expect.any(Number), runNowRestorePaused: false } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const ingestion = (await rows(t)).find((row) => row.type === "source_ingestion")!;
    await t.withIdentity(OWNER).mutation(api.jobs.pause, { jobId: ingestion._id });
    await t.run((ctx) => ctx.db.patch(ingestion._id, {
      nextRunAt: NOW,
      runNowAt: NOW,
      runtime: { runNowRequestedAt: NOW, runNowRestorePaused: true },
    }));
    await t.mutation(internal.source_jobs.tick, {});
    const afterIngestion = await t.run((ctx) => ctx.db.get("jobs", ingestion._id));
    expect(afterIngestion?.state).toBe("paused");
    expect(afterIngestion).not.toHaveProperty("runNowAt");
    expect(afterIngestion?.runtime).not.toHaveProperty("runNowRequestedAt");
    expect(await t.run((ctx) => ctx.db.query("runs").filter((q) => q.eq(q.field("jobId"), ingestion._id)).collect())).toHaveLength(1);
  });

  it("lists all generic Source Jobs with responsibility labels, workspace and running state", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const scoring = (await rows(t)).find((row) => row.type === "source_scoring")!;
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", {
        jobId: scoring._id,
        ownerId: OWNER.subject,
        instanceId: INSTANCE,
        templateId: TEMPLATE,
        agentName: TEMPLATE,
        sessionKey: "hidden-session-key",
        status: "running",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(scoring._id, { runtime: { inFlightRunId: runId }, latestRunId: runId });
    });

    const result = await t.withIdentity(OWNER).query(api.jobs.listByInstance, { instanceId: INSTANCE });
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "source_ingestion", label: "Social source ingestion", running: false, workspaceKey: "workspace-jobs" }),
      expect.objectContaining({ type: "source_scoring", label: "Source scoring", running: true, workspaceKey: "workspace-jobs" }),
      expect.objectContaining({ type: "source_routing", label: "Source routing", running: false, workspaceKey: "workspace-jobs" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("hidden-session-key");
  });

  it("keeps Jobs in a stable capability order when one Job is updated", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activate(t);
    const jobRows = await rows(t);

    await t.run(async (ctx) => {
      for (const job of jobRows) {
        await ctx.db.patch(job._id, {
          updatedAt: job.type === "source_ingestion" ? NOW + 3 : job.type === "source_scoring" ? NOW + 1 : NOW + 2,
        });
      }
    });

    const result = await t.withIdentity(OWNER).query(api.jobs.listByInstance, { instanceId: INSTANCE });
    expect(result.map((job) => job.type)).toEqual([
      "source_ingestion",
      "source_scoring",
      "source_routing",
    ]);
  });

  it("does not queue a custom capability without a registered executor", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    const jobId = await t.run((ctx) => ctx.db.insert("jobs", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE,
      templateId: TEMPLATE,
      type: "newsletter_digest",
      state: "active",
      config: {},
      runtime: {},
      unit: "daily",
      hour: 6,
      minute: 0,
      timezone: "UTC",
      nextRunAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }));

    await expect(t.withIdentity(OWNER).mutation(api.jobs.runNow, { jobId })).rejects.toThrow(/has no executor/);
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ runtime: {}, nextRunAt: NOW });
  });
});
