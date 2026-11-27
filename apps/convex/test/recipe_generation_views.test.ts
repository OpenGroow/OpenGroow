import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// ADR-087 (ticket #194): the generations of a Project, as the Recipes workspace shows them (states derived from the Runs).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../jobs.ts": () => import("../jobs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../runs.ts": () => import("../runs.js"),
  "../recipe_generation.ts": () => import("../recipe_generation.js"),
  "../recipe_generation_views.ts": () => import("../recipe_generation_views.js"),
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

const NEEDED_TOOLS = ["get_brand_core", "list_generation_sources", "get_source", "list_production_recipes", "get_production_recipe", "list_mission_types"];

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

const generate = (args: { idea?: string; instructions?: string; sources?: Id<"sources">[]; as?: ReturnType<typeof owner> } = {}) =>
  (args.as ?? owner()).mutation(api.recipe_generation.generateRecipe, {
    instanceId: INSTANCE, idea: args.idea ?? "An idea", ...(args.sources ? { sourceIds: args.sources } : {}),
    ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
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
  const { runId } = await generate({ sources: [sourceId] });
  await running(runId);
  return { runId, sourceId };
}
const proposal = (sourceIds: string[], overrides: Record<string, unknown> = {}) => ({
  kind: "proposal", name: "Example recipe", description: "d", templateId: TEMPLATE, missionType: "make_post",
  instructions: "Do the thing", constraints: ["short"], sourceIds, rationale: "because", ...overrides,
});


const list = (as = owner()) => as.query(api.recipe_generation_views.listGenerations, { instanceId: INSTANCE });
const NO_OPP = { kind: "no_opportunity", reason: "already_covered", details: "Covered." };

describe("listGenerations", () => {
  it("is empty without generation", async () => {
    expect(await list()).toEqual({ generations: [], inFlight: false });
  });

  it("shows a generation in progress, with its idea, and flags the Project as in flight", async () => {
    const { runId } = await generate({ idea: "A calm reaction", instructions: "avoid faces" });
    const result = await list();
    expect(result.inFlight).toBe(true);
    expect(result.generations).toEqual([expect.objectContaining({ generationId: runId, runId, state: "in_progress", tryCount: 1, idea: "A calm reaction", instructions: "avoid faces" })]);
  });

  it("shows a proposal ready to review, with the Run and the proposal for the review form", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    const result = await list();
    expect(result.inFlight).toBe(false);
    expect(result.generations[0]).toMatchObject({ runId, state: "ready_to_review", proposal: { name: "Example recipe" } });
  });

  it("shows the reason of a no opportunity", async () => {
    const { runId } = await started();
    await complete(runId, NO_OPP);
    expect((await list()).generations[0]).toMatchObject({ state: "no_opportunity", reason: "already_covered", details: "Covered." });
  });

  it("shows a created Recipe once the proposal was saved", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    await owner().mutation(api.production_recipes.create, {
      instanceId: INSTANCE, templateId: TEMPLATE, missionType: "make_post", name: "Example recipe", description: "d",
      instructions: "Do the thing", constraints: [], proposalRunId: runId,
    });
    const [recipe] = await recipes();
    expect((await list()).generations[0]).toMatchObject({ state: "created", recipeId: recipe!._id });
  });

  it("shows the generation as over once the Recipe it created is deleted, with nothing to review", async () => {
    const { runId, sourceId } = await started();
    await complete(runId, proposal([sourceId]));
    await owner().mutation(api.production_recipes.create, {
      instanceId: INSTANCE, templateId: TEMPLATE, missionType: "make_post", name: "Example recipe", description: "d",
      instructions: "Do the thing", constraints: [], proposalRunId: runId,
    });
    const [recipe] = await recipes();
    await owner().mutation(api.production_recipes.remove, { instanceId: INSTANCE, recipeId: recipe!._id });
    const [generation] = (await list()).generations;
    expect(generation).toMatchObject({ state: "recipe_deleted" });
    expect(generation).not.toHaveProperty("proposal");
  });

  it("shows a failure with its reason", async () => {
    const { runId } = await started();
    await fail(runId, "The Agent crashed");
    expect((await list()).generations[0]).toMatchObject({ state: "failed", reason: expect.stringContaining("The Agent crashed") });
  });

  it("is one row for a generation with retries: in progress while a retry is in flight, then failed with the last reason", async () => {
    const sourceId = await addSource();
    const { runId: first } = await generate({ sources: [sourceId] });
    let current = first;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await running(current);
      await complete(current, proposal([sourceId], { missionType: "nothing" }));
      const next = (await runs()).find((r) => r.status === "pending");
      if (attempt < 3) {
        expect(next).toBeDefined();
        const mid = await list();
        expect(mid.generations).toHaveLength(1);
        expect(mid.generations[0]).toMatchObject({ generationId: first, state: "in_progress", tryCount: attempt + 1 });
        expect(mid.inFlight).toBe(true);
        current = next!._id;
      }
    }
    const done = await list();
    expect(done.generations).toHaveLength(1);
    expect(done.generations[0]).toMatchObject({ generationId: first, runId: current, state: "failed", tryCount: 3, reason: expect.stringMatching(/does not exist/) });
    expect(done.generations[0]!.reason).not.toMatch(/^invalid_result/);
  });

  it("keeps the ten latest generations, newest first", async () => {
    const ids: Id<"runs">[] = [];
    for (let i = 0; i < 11; i++) {
      vi.setSystemTime(NOW + i * 1000);
      const { runId } = await generate();
      await running(runId);
      await complete(runId, NO_OPP);
      ids.push(runId);
    }
    const result = await list();
    expect(result.generations.map((g) => g.generationId)).toEqual(ids.slice(1).reverse());
  });

  it("shows nothing to a user who does not own the Project", async () => {
    await generate();
    expect(await list(t.withIdentity(STRANGER))).toEqual({ generations: [], inFlight: false });
  });
});

describe("proposalSources", () => {
  const sourcesOf = (runId: Id<"runs">, as = owner()) => as.query(api.recipe_generation_views.proposalSources, { instanceId: INSTANCE, runId });

  it("lists the Sources a proposal cites, with their title", async () => {
    const a = await addSource();
    const { runId } = await generate({ sources: [a] });
    await running(runId);
    await complete(runId, proposal([a]));
    expect(await sourcesOf(runId)).toEqual([{ sourceId: a, title: "about" }]);
  });

  it("skips a cited Source that no longer exists", async () => {
    const a = await addSource();
    const { runId } = await generate({ sources: [a] });
    await running(runId);
    await complete(runId, proposal([a]));
    await t.run((ctx) => ctx.db.delete(a));
    expect(await sourcesOf(runId)).toEqual([]);
  });

  it("is empty for a stranger", async () => {
    const a = await addSource();
    const { runId } = await generate({ sources: [a] });
    await running(runId);
    await complete(runId, proposal([a]));
    expect(await sourcesOf(runId, t.withIdentity(STRANGER))).toEqual([]);
  });
});
