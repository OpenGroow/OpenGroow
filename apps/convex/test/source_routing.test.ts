import { insertInstance } from "./instance_fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { officialFixtureTemplate, installTemplateRegistry } from "./helpers/template_registry.helpers";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../events.ts": () => import("../events.js"),
  "../instance_ownership.ts": () => import("../instance_ownership.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../observations_ranking.ts": () => import("../observations_ranking.js"),
  "../observations_scoring_daily.ts": () => import("../observations_scoring_daily.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../source_agent.ts": () => import("../source_agent.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../source_routing.ts": () => import("../source_routing.js"),
};

const INSTANCE = "source-routing-instance";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|source-routing", subject: "owner-source-routing" };
const NOW = 1_800_000_000_000;

let restoreRegistry: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry(
    [INSTANCE],
    await Promise.all(["@opengroow/source", "@opengroow/visual-social", "@opengroow/openmontage-agent"].map((id) => officialFixtureTemplate(id))),
  );
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

async function seedInstance(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) => insertInstance(ctx, {
    jobId: "job-source-routing",
    status: "running",
    runtimeStatus: "linked",
    runtimeReady: true,
    createdAt: new Date(NOW).toISOString(),
    openclawId: INSTANCE,
    updatedAt: new Date(NOW).toISOString(),
    userId: OWNER.subject,
  }));
}

async function activateAgent(t: ReturnType<typeof convexTest>, templateId: string, agentName = templateId.replace(/^@(.+)\/(.+)$/, "$1--$2")) {
  await t.mutation(internal.project_agents.upsert, {
    instanceId: INSTANCE,
    templateId,
    status: "active",
    workspaceKey: `${templateId}-workspace`,
    openclawAgentName: agentName,
  });
}

async function source(t: ReturnType<typeof convexTest>, scoring = { productFit: 1, replicability: 1, creativeStrength: 1 }): Promise<Id<"sources">> {
  return await t.run((ctx) => ctx.db.insert("sources", {
    instanceId: INSTANCE,
    ownerId: OWNER.subject,
    sourceId: "fixture-source",
    templateId: "@opengroow/source",
    label: "Fixture Source",
    family: "fixture",
    status: "ready",
    origin: "https://example.com/source",
    capturedAt: NOW,
    createdAt: NOW,
    marketing: { summary: "A useful source" },
    analysis: { hook: "A useful hook" },
    scoring,
  }));
}

async function routingJob(t: ReturnType<typeof convexTest>): Promise<Doc<"jobs">> {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.query("jobs").collect();
    return jobs.find((job) => job.instanceId === INSTANCE && job.type === "source_routing") as Doc<"jobs">;
  });
}

async function due(t: ReturnType<typeof convexTest>, jobId: Id<"jobs">) {
  await t.run((ctx) => ctx.db.patch(jobId, { nextRunAt: NOW - 1 }));
}

describe("Source routing Job", () => {
  it("completes successfully without a Run when no Source clears the threshold", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    await source(t, { productFit: 0, replicability: 0, creativeStrength: 0 });
    const job = await routingJob(t);
    await due(t, job._id);

    await t.action(internal.source_routing.tick, {});

    const result = await t.run(async (ctx) => ({ job: await ctx.db.get(job._id), runs: await ctx.db.query("runs").collect() }));
    expect(result.runs).toHaveLength(0);
    expect(result.job).toMatchObject({ lastOutcome: "succeeded", lastSummary: expect.stringContaining("No Source") });
  });

  it("consumes a manual no-selection pass when the Job was paused", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    await source(t, { productFit: 0, replicability: 0, creativeStrength: 0 });
    const job = await routingJob(t);
    await t.run((ctx) => ctx.db.patch(job._id, {
      state: "paused",
      nextRunAt: NOW,
      runNowAt: NOW,
      runtime: { runNowRequestedAt: NOW, runNowRestorePaused: true },
    }));

    await t.action(internal.source_routing.tick, {});

    const after = await t.run((ctx) => ctx.db.get("jobs", job._id));
    expect(after).toMatchObject({ state: "paused", lastOutcome: "succeeded" });
    expect(after).not.toHaveProperty("runNowAt");
    expect(after?.runtime).toEqual({});
  });

  it("does not restore pause after a queued Run Now was resumed", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    const job = await routingJob(t);
    await t.run((ctx) => ctx.db.patch(job._id, {
      state: "active",
      runNowAt: NOW,
      runtime: { runNowRequestedAt: NOW, runNowRestorePaused: false },
    }));

    await t.mutation(internal.source_routing.settleNoSelection, {
      jobId: job._id,
      summary: "No qualifying Source",
      requestAt: NOW,
      restorePaused: true,
    });

    const after = await t.run((ctx) => ctx.db.get("jobs", job._id));
    expect(after).toMatchObject({ state: "active", lastOutcome: "succeeded" });
    expect(after).not.toHaveProperty("runNowAt");
  });

  it("consumes a queued manual pass when the Source Agent is inactive", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    const job = await routingJob(t);
    await t.run((ctx) => ctx.db.patch(job._id, {
      state: "paused",
      nextRunAt: NOW,
      runNowAt: NOW,
      runtime: { runNowRequestedAt: NOW, runNowRestorePaused: true },
    }));
    await t.mutation(internal.project_agents.upsert, {
      instanceId: INSTANCE,
      templateId: "@opengroow/source",
      status: "inactive",
    });

    await t.action(internal.source_routing.tick, {});
    const after = await t.run((ctx) => ctx.db.get("jobs", job._id));
    expect(after?.state).toBe("paused");
    expect(after).not.toHaveProperty("runNowAt");
    expect(after?.lastOutcome).toBe("failed");
    expect(after?.lastError).toBe("Source Agent is not active");
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);
  });

  it("records a scheduled failure and advances the next run when the Source Agent is inactive", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    const job = await routingJob(t);
    await due(t, job._id);
    await t.mutation(internal.project_agents.upsert, {
      instanceId: INSTANCE,
      templateId: "@opengroow/source",
      status: "inactive",
    });
    await t.run((ctx) => ctx.db.patch(job._id, { state: "active", nextRunAt: NOW - 1 }));

    await t.action(internal.source_routing.tick, {});

    const after = await t.run((ctx) => ctx.db.get("jobs", job._id));
    expect(after).toMatchObject({
      state: "active",
      lastOutcome: "failed",
      lastError: "Source Agent is not active",
    });
    expect(after?.nextRunAt).toBeGreaterThan(NOW);
  });

  it("keeps a newer manual pass queued while a routing Run is still active", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    const job = await routingJob(t);
    const runId = await t.run((ctx) => ctx.db.insert("runs", {
      jobId: job._id,
      ownerId: OWNER.subject,
      instanceId: INSTANCE,
      templateId: "@opengroow/source",
      agentName: "source",
      sessionKey: "active-routing-run",
      status: "running",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    await t.run((ctx) => ctx.db.patch(job._id, {
      state: "paused",
      nextRunAt: NOW,
      runNowAt: NOW + 1,
      runtime: {
        inFlightRunId: runId,
        runNowRequestedAt: NOW + 1,
        runNowRestorePaused: true,
      },
    }));

    await t.action(internal.source_routing.tick, {});

    const after = await t.run((ctx) => ctx.db.get("jobs", job._id));
    expect(after).toMatchObject({
      state: "paused",
      runNowAt: NOW + 1,
      runtime: {
        inFlightRunId: runId,
        runNowRequestedAt: NOW + 1,
        runNowRestorePaused: true,
      },
    });
  });

  it("reserves the winner before creating the routing Run", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    const sourceId = await source(t);
    const job = await routingJob(t);

    const result = await t.action(internal.observations_scoring_daily.scoreEligibleForInstance, { instanceId: INSTANCE });
    expect(result).toBe(sourceId);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });

    const state = await t.run(async (ctx) => ({ source: await ctx.db.get(sourceId), job: await ctx.db.get(job._id), runs: await ctx.db.query("runs").collect(), missions: await ctx.db.query("missions").collect() }));
    expect(state.source?.selectedAt).toBe(NOW);
    expect(state.source?.productionMissionId).toBeUndefined();
    expect(state.runs).toHaveLength(1);
    expect(state.missions).toHaveLength(0);
    expect(state.job?.runtime).toMatchObject({ selectedSourceId: sourceId });
  });

  it("validates a routing result and atomically creates one production Mission", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));

    await t.mutation(internal.runs.markCompleted, {
      runId: run!._id,
      result: {
        status: "success",
        summary: "Carousel is the best producer",
        additionalDetails: { route: { templateId: "@opengroow/visual-social", missionType: "create_carousel", payload: { carouselFormat: "cards", contentPattern: "tips" } } },
      },
    });

    const result = await t.run(async (ctx) => ({ source: await ctx.db.get(sourceId), job: await ctx.db.get(job._id), missions: await ctx.db.query("missions").collect(), runs: await ctx.db.query("runs").collect(), cleanup: await ctx.db.query("commands").collect() }));
    expect(result.missions).toHaveLength(1);
    expect(result.missions[0]).toMatchObject({ templateId: "@opengroow/visual-social", type: "create_carousel", payload: { carouselFormat: "cards", contentPattern: "tips" } });
    expect(result.source?.productionMissionId).toBe(result.missions[0]!._id);
    expect(result.job).toMatchObject({ lastOutcome: "succeeded" });
    expect(result.runs).toHaveLength(2);
    expect(result.runs.some((row) => (row as { jobId?: Id<"jobs"> }).jobId === job._id)).toBe(true);
    expect(result.cleanup.some((command) => command.type === "runtime.workspace.file.delete_batch")).toBe(true);
  });

  it("allows Force production to replace the active production Mission", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    const sourceId = await source(t);
    const job = await routingJob(t);
    const previousMissionId = await t.run((ctx) => ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE,
      templateId: "@opengroow/visual-social",
      type: "create_carousel",
      payload: {},
      status: "done",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    await t.run(async (ctx) => {
      await ctx.db.patch(sourceId, { selectedAt: NOW, productionMissionId: previousMissionId });
      await ctx.db.patch(job._id, { runtime: { forcedSourceId: sourceId } });
    });
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));

    await t.mutation(internal.runs.markCompleted, {
      runId: run!._id,
      result: {
        status: "success",
        summary: "Replacement route",
        additionalDetails: { route: { templateId: "@opengroow/visual-social", missionType: "create_carousel", payload: {} } },
      },
    });

    const result = await t.run(async (ctx) => ({ source: await ctx.db.get(sourceId), missions: await ctx.db.query("missions").collect() }));
    expect(result.missions).toHaveLength(2);
    expect(result.source?.productionMissionId).not.toBe(previousMissionId);
  });

  it("fails cleanly when the selected producing Agent is deactivated before settlement", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));
    await t.mutation(internal.project_agents.upsert, {
      instanceId: INSTANCE,
      templateId: "@opengroow/visual-social",
      status: "inactive",
      workspaceKey: "visual-social-workspace",
      openclawAgentName: "visual-social",
    });

    await t.mutation(internal.runs.markCompleted, {
      runId: run!._id,
      result: {
        status: "success",
        summary: "Carousel is the best producer",
        additionalDetails: { route: { templateId: "@opengroow/visual-social", missionType: "create_carousel", payload: {} } },
      },
    });

    const result = await t.run(async (ctx) => ({
      source: await ctx.db.get(sourceId),
      job: await ctx.db.get(job._id),
      missions: await ctx.db.query("missions").collect(),
      runs: await ctx.db.query("runs").collect(),
    }));
    expect(result.source?.selectedAt).toBe(NOW);
    expect(result.source?.productionMissionId).toBeUndefined();
    expect(result.missions).toHaveLength(0);
    expect(result.runs).toHaveLength(1);
    expect(result.job).toMatchObject({ lastOutcome: "failed", lastError: expect.stringContaining("no longer active") });
  });

  it("rejects a create_reel route without publish and injects the Source as observationId otherwise", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/openmontage-agent");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));

    await t.mutation(internal.runs.markCompleted, {
      runId: run!._id,
      result: { status: "success", summary: "Reel", additionalDetails: { route: { templateId: "@opengroow/openmontage-agent", missionType: "create_reel", payload: {} } } },
    });
    const rejected = await t.run(async (ctx) => ({ missions: await ctx.db.query("missions").collect(), runs: await ctx.db.query("runs").collect() }));
    expect(rejected.missions).toHaveLength(0);
    expect(rejected.runs).toHaveLength(2);

    const retry = rejected.runs.find((row) => row._id !== run!._id)!;
    await t.run((ctx) => ctx.db.patch(retry._id, { status: "running" }));
    const publish = { platforms: ["instagram"], title: "Title", description: "Description" };
    await t.mutation(internal.runs.markCompleted, {
      runId: retry._id,
      result: { status: "success", summary: "Reel", additionalDetails: { route: { templateId: "@opengroow/openmontage-agent", missionType: "create_reel", payload: { publish } } } },
    });
    const accepted = await t.run((ctx) => ctx.db.query("missions").collect());
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ type: "create_reel", payload: { publish, observationId: sourceId } });
  });

  it("drops a router-authored prompt or shots from a create_reel route and keeps the Source as observationId", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/openmontage-agent");
    await t.run((ctx) => ctx.db.insert("brandCores", { instanceId: INSTANCE, audience: "Audience", offer: "Offer", updatedAt: NOW }));
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));
    const publish = { platforms: ["instagram"], title: "Title", description: "Description" };

    await t.mutation(internal.runs.markCompleted, {
      runId: run!._id,
      result: {
        status: "success",
        summary: "Reel",
        additionalDetails: {
          route: {
            templateId: "@opengroow/openmontage-agent",
            missionType: "create_reel",
            payload: { publish, prompt: "copy of the source", shots: [{ durationSeconds: 4, prompt: "x", beat: "y" }], observationId: "forged" },
          },
        },
      },
    });
    const missions = await t.run((ctx) => ctx.db.query("missions").collect());
    expect(missions).toHaveLength(1);
    expect(missions[0].payload).toEqual({ publish, observationId: sourceId });
  });

  it("retries invalid output without releasing the reserved Source", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));

    await t.mutation(internal.runs.markCompleted, { runId: run!._id, result: { status: "success", summary: "bad", additionalDetails: { route: { templateId: "unknown", missionType: "unknown", payload: {} } } } });

    const result = await t.run(async (ctx) => ({ source: await ctx.db.get(sourceId), job: await ctx.db.get(job._id), runs: await ctx.db.query("runs").collect(), missions: await ctx.db.query("missions").collect() }));
    expect(result.source?.selectedAt).toBe(NOW);
    expect(result.source?.productionMissionId).toBeUndefined();
    expect(result.runs).toHaveLength(2);
    expect(result.job?.lastOutcome).toBeUndefined();
    expect(result.missions).toHaveLength(0);
  });

  it("does not return a Source to the pool after a runtime failure", async () => {
    const t = convexTest(schema, modules);
    await seedInstance(t);
    await activateAgent(t, "@opengroow/source");
    await activateAgent(t, "@opengroow/visual-social");
    const sourceId = await source(t);
    const job = await routingJob(t);
    await t.mutation(internal.source_routing.reserveWinner, { jobId: job._id, sourceId });
    const run = await t.run((ctx) => ctx.db.query("runs").unique());
    await t.run((ctx) => ctx.db.patch(run!._id, { status: "running" }));

    await t.mutation(internal.runs.markFailed, { runId: run!._id, code: "runtime", message: "Agent stopped" });

    const result = await t.run(async (ctx) => ({ source: await ctx.db.get(sourceId), job: await ctx.db.get(job._id), runs: await ctx.db.query("runs").collect() }));
    expect(result.source?.selectedAt).toBe(NOW);
    expect(result.source?.productionMissionId).toBeUndefined();
    expect(result.runs).toHaveLength(1);
    expect(result.job).toMatchObject({ lastOutcome: "failed" });
  });
});
