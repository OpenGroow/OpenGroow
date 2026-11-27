import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { failScoringRun } from "../score_jobs";
import { failStrategicReviewRun } from "../strategic_review_jobs";
import { failContentPlanningRun } from "../content_planning_runs";
import { failRecipeGenerationRun } from "../recipe_generation";
import { settleSourceJobRun } from "../source_jobs";
import { fixtureTemplate, installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// ADR-091 (ticket #210): a Template version below profile schemaVersion 2 is outdated. Nothing new starts from it,
// everything already produced stays readable, and a Schedule or Job skips its occurrences until the Template is updated.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../missions.ts": () => import("../missions.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../recipe_generation.ts": () => import("../recipe_generation.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../strategic_review_jobs.ts": () => import("../strategic_review_jobs.js"),
  "../content_planning_jobs.ts": () => import("../content_planning_jobs.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
};

const PROJECT = "instance-outdated";
const TEMPLATE = "@example/writer";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-outdated", subject: "owner-outdated" };
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

const writer = (schemaVersion: 1 | 2) =>
  fixtureTemplate(TEMPLATE, { schemaVersion, missionTypes: [{ type: "write_post", kind: "operational", label: "Post", payload: "{}", agentsMd: "post.md" }] });

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: (() => void) | undefined;

/** The Project's Template is installed at this schema version (installing the update replaces it). */
function installWriter(schemaVersion: 1 | 2) {
  restoreRegistry?.();
  restoreRegistry = installTemplateRegistry([PROJECT], [writer(schemaVersion)]);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  t = convexTest(schema, modules);
  await t.run((ctx) => insertInstance(ctx, {
    jobId: "job-outdated", status: "running", runtimeStatus: "linked", runtimeReady: true,
    createdAt: new Date(NOW).toISOString(), openclawId: PROJECT, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
  }));
  await t.mutation(internal.project_agents.upsert, { instanceId: PROJECT, templateId: TEMPLATE, status: "active", workspaceKey: "ws", openclawAgentName: "writer" });
});

afterEach(() => {
  restoreRegistry?.();
  restoreRegistry = undefined;
  vi.useRealTimers();
});

const owner = () => t.withIdentity(OWNER);
const rows = <N extends "missions" | "runs" | "projectCounters" | "schedules">(table: N) => t.run((ctx) => ctx.db.query(table).collect());
const createPost = () => owner().mutation(api.missions.create, { instanceId: PROJECT, templateId: TEMPLATE, type: "write_post", payload: {} });

/** A Mission created while the Template was still current, with its first Run. */
async function missionCreatedBeforeTheTemplateAged(): Promise<{ missionId: Id<"missions">; runId: Id<"runs"> }> {
  installWriter(2);
  const created = await createPost();
  installWriter(1);
  return created;
}

describe("Mission creation and the new Runs of a Mission", () => {
  it("refuses to create a Mission from an outdated Template and leaves nothing behind", async () => {
    installWriter(1);
    await expect(createPost()).rejects.toThrow(/outdated.*update/i);
    expect(await rows("missions")).toEqual([]);
    expect(await rows("runs")).toEqual([]);
    expect(await rows("projectCounters")).toEqual([]);
  });

  it("creates a Mission once the Template is updated", async () => {
    installWriter(1);
    await expect(createPost()).rejects.toThrow();
    installWriter(2);
    const { missionId, runId } = await createPost();
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ missionId, status: "pending" });
  });

  it("refuses the retry of a failed Mission, and a revision of its content, without starting a Run", async () => {
    const { missionId, runId } = await missionCreatedBeforeTheTemplateAged();
    await t.run((ctx) => ctx.db.patch(missionId, { status: "failed" }));

    await expect(owner().mutation(api.missions.retryMission, { missionId, sourceRunId: runId })).rejects.toThrow(/outdated/i);
    await expect(t.mutation(internal.missions.rejectMission, { missionId, ownerId: OWNER.subject, feedback: "Shorter", eventType: "ReviewRejected" })).rejects.toThrow(/outdated/i);

    expect(await rows("runs")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({ status: "failed" });
  });

  it("starts no Run when an external job asks to resume the Mission, and ends it as failed instead of leaving it waiting", async () => {
    const { missionId } = await missionCreatedBeforeTheTemplateAged();
    await t.run((ctx) => ctx.db.patch(missionId, { status: "doing" }));

    const resumed = await t.mutation(internal.missions.resumeMission, { missionId, intermediateResult: { jobType: "render", output: {} } });

    expect(resumed.runId).toBeNull();
    expect(await rows("runs")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("outdated") });
  });

  it("keeps the history readable and a Run already inserted completes normally", async () => {
    const { missionId, runId } = await missionCreatedBeforeTheTemplateAged();

    expect(await owner().query(api.missions.get, { missionId })).toMatchObject({ _id: missionId, templateId: TEMPLATE });

    await t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
    await t.mutation(internal.runs.markCompleted, { runId, result: { status: "success", summary: "Done before the switch" } });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: "completed" });
  });
});

describe("Schedules", () => {
  const seedSchedule = () => t.run((ctx) => ctx.db.insert("schedules", {
    ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, type: "write_post", payload: {},
    unit: "daily", hour: 9, minute: 0, timezone: "Europe/Paris", status: "active",
    nextRunAt: NOW - 1000, createdAt: NOW, updatedAt: NOW,
  }));
  const schedule = (id: Id<"schedules">) => t.run((ctx) => ctx.db.get(id)) as Promise<Doc<"schedules">>;

  it("skips an occurrence without a Mission or an error, keeps its status, and runs at its next occurrence after the update", async () => {
    installWriter(1);
    const id = await seedSchedule();

    await t.action(internal.schedules.tick, {});

    expect(await rows("missions")).toEqual([]);
    expect((await schedule(id)).status).toBe("active");
    expect((await schedule(id)).lastError).toBeUndefined();
    expect((await schedule(id)).nextRunAt).toBeGreaterThan(NOW);

    installWriter(2);
    await t.run((ctx) => ctx.db.patch(id, { nextRunAt: NOW - 1 }));
    await t.action(internal.schedules.tick, {});

    expect(await rows("missions")).toHaveLength(1);
    expect((await schedule(id)).lastError).toBeUndefined();
  });
});

describe("Jobs and Recipe Generation", () => {
  const seedJob = (type: Doc<"jobs">["type"], overrides: Partial<Doc<"jobs">> = {}) => t.run((ctx) => ctx.db.insert("jobs", {
    ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, type, state: "active", config: {}, runtime: {},
    unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW - 1000, createdAt: NOW, updatedAt: NOW, ...overrides,
  } as Parameters<typeof ctx.db.insert<"jobs">>[1]));
  const job = (id: Id<"jobs">) => t.run((ctx) => ctx.db.get(id)) as Promise<Doc<"jobs">>;

  it("refuses Run now of a Job of an outdated Template", async () => {
    installWriter(1);
    const id = await seedJob("strategic_review");
    await expect(owner().mutation(api.jobs.runNow, { jobId: id })).rejects.toThrow(/outdated/i);
    expect((await job(id)).runNowAt).toBeUndefined();
  });

  it("skips a due Job pass and a queued Run now without a Run or an error, then runs again after the update", async () => {
    installWriter(2);
    const id = await seedJob("strategic_review", { runNowAt: NOW - 10, runtime: { runNowRequestedAt: NOW - 10, runNowRestorePaused: false } });
    installWriter(1);

    await t.mutation(internal.strategic_review_jobs.tick, {});

    expect(await rows("runs")).toEqual([]);
    const skipped = await job(id);
    expect(skipped).toMatchObject({ state: "active", lastOutcome: "skipped" });
    expect(skipped.runNowAt).toBeUndefined();
    expect(skipped.lastError).toBeUndefined();
    expect(skipped.nextRunAt).toBeGreaterThan(NOW);

    installWriter(2);
    await t.run((ctx) => ctx.db.patch(id, { nextRunAt: NOW - 1 }));
    await t.mutation(internal.strategic_review_jobs.tick, {});
    expect(await rows("runs")).toHaveLength(1);
  });

  describe("an automatic retry once the Template is outdated", () => {
    /** A Job of the type with one Run in flight, inserted while the Template was current; the Template then ages. */
    async function jobWithRunInFlight(type: Doc<"jobs">["type"], run: Partial<Doc<"runs">> = {}, runtime: Record<string, unknown> = {}) {
      installWriter(2);
      const jobId = await seedJob(type);
      const runId = await t.run((ctx) => ctx.db.insert("runs", {
        jobId, ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, agentName: "writer", sessionKey: "s",
        status: "failed", createdAt: NOW, updatedAt: NOW, ...run,
      } as Parameters<typeof ctx.db.insert<"runs">>[1]));
      await t.run((ctx) => ctx.db.patch(jobId, { runtime: { inFlightRunId: runId, inFlightTries: 0, ...runtime } }));
      installWriter(1);
      return { jobId, run: (await t.run((ctx) => ctx.db.get(runId)))! };
    }
    const expectEndedWithoutRun = async (jobId: Id<"jobs">) => {
      expect(await rows("runs")).toHaveLength(1);
      const ended = await job(jobId);
      expect(ended.lastOutcome).toBe("failed");
      expect(ended.lastError).toMatch(/outdated.*update/i);
      expect((ended.runtime as Record<string, unknown>).inFlightRunId).toBeUndefined();
    };

    it("Source scoring inserts no Run and fails the Job with the reason", async () => {
      const { jobId, run } = await jobWithRunInFlight("source_scoring", {}, { inFlightBatch: { sourceIds: [] } });
      await t.run((ctx) => failScoringRun(ctx, { _id: run._id, agentName: run.agentName, jobId }, "timeout", true));
      await expectEndedWithoutRun(jobId);
    });

    it("a Strategic Review inserts no Run and fails the Job with the reason", async () => {
      const { jobId, run } = await jobWithRunInFlight("strategic_review", { strategicReview: { periodStart: NOW - 1, periodEnd: NOW } });
      await t.run((ctx) => failStrategicReviewRun(ctx, run, jobId, "timeout", true));
      await expectEndedWithoutRun(jobId);
    });

    it("Content Planning inserts no Run and fails the Job with the reason", async () => {
      const pins = { periodStart: "2030-03-04", periodEnd: "2030-03-10", targets: [], ignored: [] };
      const { jobId, run } = await jobWithRunInFlight("content_planning", { contentPlanning: pins });
      await t.run((ctx) => failContentPlanningRun(ctx, run, jobId, "invalid_result: bad", ["bad"]));
      await expectEndedWithoutRun(jobId);
    });

    it("Source ingestion resumes no execution after an invalid result and fails the Job with the reason", async () => {
      const { jobId, run } = await jobWithRunInFlight("source_ingestion", { status: "running" });
      await t.run((ctx) => settleSourceJobRun(ctx, run, { ok: false, error: "invalid", feedback: { errors: [{ messages: ["bad entry"] }] } }));
      await expectEndedWithoutRun(jobId);
    });

    it("a Recipe Generation inserts no Run and its last try says why", async () => {
      installWriter(2);
      const runId = await t.run((ctx) => ctx.db.insert("runs", {
        ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, agentName: "writer", sessionKey: "s", status: "failed",
        errorMessage: "invalid_result: bad", createdAt: NOW, updatedAt: NOW, recipeGeneration: { idea: "An idea", sourceIds: [], tryCount: 1 },
      }));
      installWriter(1);
      const run = (await t.run((ctx) => ctx.db.get(runId)))!;
      await t.run((ctx) => failRecipeGenerationRun(ctx, run, ["bad"]));
      expect(await rows("runs")).toHaveLength(1);
      expect((await t.run((ctx) => ctx.db.get(runId)))?.errorMessage).toMatch(/invalid_result: bad.*outdated.*update/i);
    });
  });

  it("refuses a Recipe Generation on an outdated Strategy Agent and inserts no Run", async () => {
    const base = loadFixtureTemplate("strategy-capable");
    const tools = ["get_brand_core", "list_generation_sources", "get_source", "list_production_recipes", "get_production_recipe", "list_mission_types"];
    const strategist = (schemaVersion: 1 | 2) => ({
      ...base,
      manifest: { ...base.manifest, schemaVersion, mcpServers: [{ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } }] },
    }) as unknown as typeof base;
    await t.mutation(internal.project_agents.upsert, { instanceId: PROJECT, templateId: base.manifest.id, status: "active", workspaceKey: "ws-s", openclawAgentName: "strategist" });

    restoreRegistry?.();
    restoreRegistry = installTemplateRegistry([PROJECT], [strategist(1)]);
    await expect(owner().mutation(api.recipe_generation.generateRecipe, { instanceId: PROJECT, idea: "A calm morning routine" })).rejects.toThrow(/outdated/i);
    expect(await rows("runs")).toEqual([]);

    restoreRegistry();
    restoreRegistry = installTemplateRegistry([PROJECT], [strategist(2)]);
    await owner().mutation(api.recipe_generation.generateRecipe, { instanceId: PROJECT, idea: "A calm morning routine" });
    expect(await rows("runs")).toHaveLength(1);
  });
});
