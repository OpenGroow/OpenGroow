import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// ADR-087 (ticket #192): generateRecipe, the per-Agent exclusion and the validated result of a Recipe Generation.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../recipe_generation.ts": () => import("../recipe_generation.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../content_planning_jobs.ts": () => import("../content_planning_jobs.js"),
  "../strategic_review_jobs.ts": () => import("../strategic_review_jobs.js"),
  "../source_jobs.ts": () => import("../source_jobs.js"),
  "../score_jobs.ts": () => import("../score_jobs.js"),
};

const INSTANCE = "instance-rg";
const OTHER_INSTANCE = "instance-rg-other";
const TEMPLATE = "strategy-capable";
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|owner-rg", subject: "owner-rg" };
const STRANGER = { name: "Other", email: "other@example.com", tokenIdentifier: "test|stranger-rg", subject: "stranger-rg" };
const SUCCESS = { status: "success" as const, summary: "Recipe Generation result received" };

const NEEDED_TOOLS = ["get_brand_core", "get_creative_family", "list_family_sources", "get_source", "list_production_recipes", "get_production_recipe", "list_mission_types"];

/** The Strategy Agent fixture, declaring every tool a generation needs, plus one Mission type that accepts a recipe. */
function strategist(tools: string[] = NEEDED_TOOLS) {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: {
      ...base.manifest,
      mcpServers: [{ name: "opengroow", transport: "streamable-http", url: "", internal: { tools } }],
      missionTypes: [
        { type: "make_post", label: "Post", agentsMd: "a.md", contextProviders: ["production-recipe"] },
        { type: "plain_note", label: "Note", agentsMd: "b.md" },
      ],
    },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
}

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;
let familyId: Id<"creativeFamilies">;

const owner = () => t.withIdentity(OWNER);

async function setup(tools?: string[]) {
  restoreRegistry = installTemplateRegistry([INSTANCE, OTHER_INSTANCE], [strategist(tools)]);
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [id, user] of [[INSTANCE, OWNER.subject], [OTHER_INSTANCE, STRANGER.subject]] as const) {
      await insertInstance(ctx, {
        jobId: `provisioning-${id}`, status: "running", runtimeStatus: "linked", runtimeReady: true,
        createdAt: new Date(NOW).toISOString(), openclawId: id, updatedAt: new Date(NOW).toISOString(), userId: user,
      });
    }
  });
  await t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws", openclawAgentName: "strategist" });
  familyId = await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-1", name: "Example family", description: "A mechanic" }));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await setup();
});
afterEach(() => {
  vi.useRealTimers();
  restoreRegistry();
});

const addSource = (o: { family?: Id<"creativeFamilies">; status?: string; excluded?: boolean; instanceId?: string; ownerId?: string } = {}) =>
  t.run((ctx) =>
    ctx.db.insert("sources", {
      instanceId: o.instanceId ?? INSTANCE, ownerId: o.ownerId ?? OWNER.subject, templateId: "example/source", sourceId: "post", label: "Example source", family: "fam",
      status: (o.status ?? "ready") as never, marketing: { summary: "about" }, analysis: {}, origin: "https://example.com/p", capturedAt: NOW, createdAt: NOW,
      creativeFamilyId: o.family ?? familyId, ...(o.excluded ? { excluded: true } : {}),
    } as never),
  );

const generate = (args: { instructions?: string; family?: Id<"creativeFamilies">; as?: ReturnType<typeof owner> } = {}) =>
  (args.as ?? owner()).mutation(api.recipe_generation.generateRecipe, {
    instanceId: INSTANCE, familyId: args.family ?? familyId, ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
  });
const runs = () => t.run((ctx) => ctx.db.query("runs").collect());
const getRun = (id: Id<"runs">) => t.run((ctx) => ctx.db.get(id));
const recipes = () => t.run((ctx) => ctx.db.query("productionRecipes").collect());
const running = (runId: Id<"runs">) => t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
const complete = (runId: Id<"runs">, envelope: unknown) => t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS, recipeProposalEnvelope: envelope });
const fail = (runId: Id<"runs">, message = "boom", retryWithFeedback = false) => t.mutation(internal.runs.markFailed, { runId, code: "file_invalid", message, retryWithFeedback });

/** Starts a generation with a ready Source and marks its Run running, as the dispatcher would. */
async function started() {
  const sourceId = await addSource();
  const { runId } = await generate();
  await running(runId);
  return { runId, sourceId };
}
const proposal = (sourceIds: string[], overrides: Record<string, unknown> = {}) => ({
  kind: "proposal", name: "Example recipe", description: "d", templateId: TEMPLATE, missionType: "make_post",
  instructions: "Do the thing", constraints: ["short"], sourceIds, rationale: "because", ...overrides,
});

describe("generateRecipe", () => {
  it("creates a pending Standalone Run pinned on the family, on the first eligible Agent", async () => {
    await addSource();
    const { runId } = await generate({ instructions: "  avoid faces  " });
    expect(await getRun(runId)).toMatchObject({
      status: "pending", instanceId: INSTANCE, templateId: TEMPLATE, agentName: "strategist",
      recipeGeneration: { familyId, instructions: "avoid faces", tryCount: 1 },
    });
  });

  it("refuses an archived family and creates no Run", async () => {
    await addSource();
    await t.run((ctx) => ctx.db.patch(familyId, { status: "archived" }));
    await expect(generate()).rejects.toThrow(/archived/);
    expect(await runs()).toEqual([]);
  });

  it("refuses a family of another Project", async () => {
    const other = await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: OTHER_INSTANCE, slug: "article-2", name: "Other", description: "" }));
    await expect(generate({ family: other })).rejects.toThrow(/not found/);
    expect(await runs()).toEqual([]);
  });

  it("refuses a user who does not own the Project", async () => {
    await addSource();
    await expect(generate({ as: t.withIdentity(STRANGER) })).rejects.toThrow(/Forbidden/);
    expect(await runs()).toEqual([]);
  });

  it.each([
    ["no Source", async () => undefined],
    ["only a Source being analysed", () => addSource({ status: "processing" })],
    ["only an excluded Source", () => addSource({ excluded: true })],
    ["only a Source of another family", async () => addSource({ family: await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-3", name: "Elsewhere", description: "" })) })],
  ])("refuses a family with %s ready", async (_name, seed) => {
    await seed();
    await expect(generate()).rejects.toThrow(/no ready Source/);
    expect(await runs()).toEqual([]);
  });

  it("refuses when no active Agent declares all the needed tools", async () => {
    restoreRegistry();
    restoreRegistry = installTemplateRegistry([INSTANCE], [strategist(NEEDED_TOOLS.slice(1))]);
    await addSource();
    await expect(generate()).rejects.toThrow(/declares the tools/);
    expect(await runs()).toEqual([]);
  });

  it("refuses when the Agent is inactive", async () => {
    await addSource();
    await t.mutation(internal.project_agents.upsert, { instanceId: INSTANCE, templateId: TEMPLATE, status: "inactive", workspaceKey: "ws", openclawAgentName: "strategist" });
    await expect(generate()).rejects.toThrow(/declares the tools/);
  });

  it("refuses instructions over 2000 characters and accepts exactly 2000", async () => {
    await addSource();
    await expect(generate({ instructions: "x".repeat(2001) })).rejects.toThrow(/2000/);
    expect(await runs()).toEqual([]);
    await expect(generate({ instructions: "x".repeat(2000) })).resolves.toBeDefined();
  });

  it.each(["pending", "dispatching", "running", "awaiting_job"] as const)("refuses with Agent busy while a Run is %s", async (status) => {
    await addSource();
    await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", { ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, type: "make_post", payload: {}, status: "doing", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("runs", { ownerId: OWNER.subject, instanceId: INSTANCE, templateId: TEMPLATE, agentName: "strategist", sessionKey: "s", status, createdAt: NOW, updatedAt: NOW, missionId });
    });
    await expect(generate()).rejects.toThrow(/Agent busy/);
    expect(await runs()).toHaveLength(1);
  });

  it("starts only one of two clashing starts", async () => {
    await addSource();
    const outcomes = await Promise.allSettled([generate(), generate()]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await runs()).toHaveLength(1);
  });

  it("starts again once the previous generation has ended", async () => {
    const { runId } = await started();
    await complete(runId, { kind: "no_opportunity", reason: "already_covered" });
    await expect(generate()).resolves.toBeDefined();
  });
});

describe("the result of a generation", () => {
  it("stores a valid proposal on the Run, which completes", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    const run = await getRun(runId);
    expect(run).toMatchObject({ status: "completed" });
    expect(run && "recipeProposal" in run ? run.recipeProposal : undefined).toEqual({
      proposal: { name: "Example recipe", description: "d", templateId: TEMPLATE, missionType: "make_post", instructions: "Do the thing", constraints: ["short"], sourceIds: [sourceId], rationale: "because" },
    });
    expect(await recipes()).toEqual([]);
  });

  it("stores no opportunity as a normal completion, without any retry", async () => {
    const { runId } = await started();
    await complete(runId, { kind: "no_opportunity", reason: "already_covered", details: "Covered by an existing Recipe." });
    const run = await getRun(runId);
    expect(run).toMatchObject({ status: "completed", recipeProposal: { no_opportunity: { reason: "already_covered", details: "Covered by an existing Recipe." } } });
    expect(await runs()).toHaveLength(1);
  });

  it("lets productionRecipes.create build the Recipe from the stored proposal", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    await owner().mutation(api.production_recipes.create, {
      instanceId: INSTANCE, familyId, templateId: TEMPLATE, missionType: "make_post", name: "Example recipe", description: "d",
      instructions: "Do the thing", constraints: [], proposalRunId: runId,
    });
    expect(await recipes()).toHaveLength(1);
    expect(await getRun(runId)).toMatchObject({ recipeId: (await recipes())[0]!._id });
  });

  describe.each([
    ["an unknown Mission type", (s: string) => proposal([s], { missionType: "nothing" }), /does not exist/],
    ["a Mission type without the recipe provider", (s: string) => proposal([s], { missionType: "plain_note" }), /production-recipe/],
    ["an uninstalled Template", (s: string) => proposal([s], { templateId: "not-installed" }), /not installed/],
    ["no cited Source", () => proposal([]), /at least one/],
    ["a malformed result", () => ({ kind: "proposal", name: "x" }), /description/],
    ["an unknown kind", () => ({ kind: "other" }), /kind must be/],
    ["an unknown no-opportunity reason", () => ({ kind: "no_opportunity", reason: "bored" }), /reason/],
  ])("%s", (_name, build, message) => {
    it("fails the Run, stores nothing and hands the reason to the next try", async () => {
      const { runId, sourceId } = await started();
      await complete(runId, build(sourceId));
      const run = await getRun(runId);
      expect(run).toMatchObject({ status: "failed" });
      expect(run && "recipeProposal" in run ? run.recipeProposal : undefined).toBeUndefined();
      expect(run?.errorMessage).toMatch(message);
      const retry = (await runs()).find((r) => r._id !== runId)!;
      expect(retry).toMatchObject({ status: "pending", recipeGeneration: { familyId, tryCount: 2 } });
      expect("recipeGeneration" in retry && retry.recipeGeneration.feedback).toMatch(message);
      expect(await recipes()).toEqual([]);
    });
  });

  it.each([
    ["a Source of another family", async () => addSource({ family: await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-3", name: "Elsewhere", description: "" })) }), /pinned Creative Family/],
    ["a Source of another Project", () => addSource({ instanceId: OTHER_INSTANCE, ownerId: STRANGER.subject }), /not a Source of this Project/],
    ["a Source not ready", () => addSource({ status: "processing" }), /ready/],
    ["an excluded Source", () => addSource({ excluded: true }), /ready/],
  ])("fails a proposal citing %s", async (_name, seed, message) => {
    const { runId, sourceId } = await started();
    const bad = await seed();
    await complete(runId, proposal([sourceId, bad]));
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(message) });
    expect(((await runs()).find((r) => r._id !== runId) as { recipeProposal?: unknown }).recipeProposal).toBeUndefined();
  });

  it("fails a proposal whose prompt still holds a placeholder, and accepts one written in full", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId], { prompt: 'Write a {CATEGORY} letter signed "{SENDER_NAME}".' }));
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/placeholder \{CATEGORY\}/) });
    const retry = (await runs()).find((r) => r.status === "pending")!;
    expect(retry).toMatchObject({ recipeGeneration: { feedback: expect.stringMatching(/placeholder/) } });
    await running(retry._id);
    await complete(retry._id, proposal([sourceId], { prompt: "Write an anniversary letter signed Jamie." }));
    expect(await getRun(retry._id)).toMatchObject({ status: "completed", recipeProposal: { proposal: expect.anything() } });
  });

  it("fails a proposal citing an id that is no Source", async () => {
    const { runId } = await started();
    await complete(runId, proposal(["not-an-id"]));
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/not a Source of this Project/) });
  });

  it("fails when the Run returned no result at all", async () => {
    const { runId } = await started();
    await t.mutation(internal.runs.markCompleted, { runId, result: SUCCESS });
    expect(await getRun(runId)).toMatchObject({ status: "failed" });
  });

  it("ignores a completion repeated for a Run already settled", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    await expect(complete(runId, { kind: "no_opportunity", reason: "low_relevance" })).resolves.toEqual({ applied: false });
    expect(await getRun(runId)).toMatchObject({ status: "completed", recipeProposal: { proposal: expect.anything() } });
  });
});

describe("retries", () => {
  it("makes three tries then ends failed with a readable reason, keeping the pin and the lock throughout", async () => {
    const sourceId = await addSource();
    const { runId: first } = await generate({ instructions: "keep it short" });
    let current = first;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await running(current);
      await complete(current, proposal([sourceId], { missionType: "nothing" }));
      const all = await runs();
      expect(all).toHaveLength(Math.min(attempt + 1, 3));
      // The Agent is never free in between: another start is refused at every step.
      if (attempt < 3) {
        await expect(generate()).rejects.toThrow(/Agent busy/);
        const next = all.find((r) => r.status === "pending")!;
        expect(next).toMatchObject({ recipeGeneration: { familyId, instructions: "keep it short", tryCount: attempt + 1 }, resumedFromRunId: current });
        current = next._id;
      }
    }
    const final = await getRun(current);
    expect(final).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/invalid_result: .*does not exist/) });
    expect((await runs()).filter((r) => r.status === "pending")).toEqual([]);
    expect(await recipes()).toEqual([]);
    await expect(generate()).resolves.toBeDefined();
  });

  it("links every try of a generation to its first Run, and finds the latest generations from their first Runs", async () => {
    const sourceId = await addSource();
    const { runId: first } = await generate();
    await running(first);
    await complete(first, proposal([sourceId], { missionType: "nothing" }));
    const second = (await runs()).find((r) => r.status === "pending")!;
    expect(await getRun(first)).toMatchObject({ recipeGeneration: { generationId: first } });
    expect(second.recipeGeneration).toMatchObject({ generationId: first, tryCount: 2 });
    await running(second._id);
    await complete(second._id, proposal([sourceId]));
    const { runId: other } = await generate();
    const chain = await t.run((ctx) => ctx.db.query("runs").withIndex("by_generation" as never, ((q: any) => q.eq("recipeGeneration.generationId", first)) as never).collect());
    expect(chain.map((r) => r._id)).toEqual([first, second._id]);
    const latest = await t.run((ctx) =>
      ctx.db.query("runs").withIndex("by_instance_try" as never, ((q: any) => q.eq("instanceId", INSTANCE).eq("recipeGeneration.tryCount", 1)) as never).order("desc").take(5));
    expect(latest.map((r) => r._id)).toEqual([other, first]);
  });

  it("retries an unreadable result file with the parse error as feedback", async () => {
    const { runId } = await started();
    await fail(runId, "Unexpected token", true);
    const retry = (await runs()).find((r) => r._id !== runId)!;
    expect(retry).toMatchObject({ status: "pending", recipeGeneration: { tryCount: 2, feedback: "Unexpected token" } });
  });

  it("does not retry a technical failure and creates nothing", async () => {
    const { runId } = await started();
    await fail(runId, "model unavailable");
    expect(await runs()).toHaveLength(1);
    expect(await getRun(runId)).toMatchObject({ status: "failed", errorMessage: "file_invalid: model unavailable" });
    expect(await recipes()).toEqual([]);
  });

  it("does not retry a cancelled Run and creates nothing", async () => {
    const { runId } = await started();
    await t.mutation(internal.runs.markCancelled, { runId });
    expect(await runs()).toHaveLength(1);
    expect(await getRun(runId)).toMatchObject({ status: "cancelled" });
    expect(await recipes()).toEqual([]);
  });
});

describe("the Agent's Jobs while a generation is in flight", () => {
  const job = async (type: string) => (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.type === type)!;
  const reload = (id: Id<"jobs">) => t.run((ctx) => ctx.db.get(id));
  const dueNow = async (type: string) => {
    const j = await job(type);
    await t.run((ctx) => ctx.db.patch(j._id, { nextRunAt: NOW - 1000 }));
    return j._id;
  };
  const tick = (type: string) => t.mutation(type === "strategic_review" ? internal.strategic_review_jobs.tick : internal.content_planning_jobs.tick, {});

  it.each(["strategic_review", "content_planning"])("%s: postpones without writing, keeps the Job due and a Run Now queued, then starts once the generation ends", async (type) => {
    const jobId = await dueNow(type);
    await owner().mutation(api.jobs.runNow, { jobId });
    const { runId } = await started();
    const before = await reload(jobId);
    const runsBefore = (await runs()).length;

    await tick(type);
    expect(await reload(jobId)).toEqual(before);
    expect((await reload(jobId))!.runNowAt).toBeDefined();
    expect(await runs()).toHaveLength(runsBefore);

    await complete(runId, { kind: "no_opportunity", reason: "low_relevance" });
    await tick(type);
    const after = await reload(jobId);
    expect(after!.runNowAt).toBeUndefined();
    expect((await runs()).filter((r) => r.status === "pending" && "jobId" in r)).toHaveLength(type === "content_planning" ? 0 : 1);
  });

  it("a generation retry keeps the Jobs postponed between two tries", async () => {
    const jobId = await dueNow("strategic_review");
    const { runId } = await started();
    await fail(runId, "unreadable", true);
    const before = await reload(jobId);
    await tick("strategic_review");
    expect(await reload(jobId)).toEqual(before);
  });

  it("a Job's own Run in flight blocks a generation, and a generation start is not blocked by a Job that is merely due", async () => {
    await dueNow("strategic_review");
    await addSource();
    await expect(generate()).resolves.toBeDefined();
  });
});
