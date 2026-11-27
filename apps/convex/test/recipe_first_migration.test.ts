import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installPostiz } from "./postiz_fixture";
import { storeOutdatedVersion } from "./helpers/outdated_version";
import { fixtureTemplate, inMemoryRegistry } from "./helpers/template_registry.helpers";
import { setTemplateRegistryForTests } from "../template_registry";
import { offerTemplateUpdate } from "../template_registry_store";
import { applyStagedUpdate, installTemplatePackage } from "../template_install";
import { readClawPackageFixture, withFile, type PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// Recipe-first Production (ADR-091, #219): the coordinated switch of a Project from Template contract v1 to v2,
// checked end to end on the backend. Provisioning and Schedule backfill are covered one by one in
// bundled_recipes.test.ts and schedule_recipes.test.ts, the blocking of an outdated version in
// outdated_template_blocking.test.ts; this file covers the whole migration of a Project with a history, and what
// must stay available or untouched around it.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../commands_node.ts": () => import("../commands_node.js"),
  "../connect_tickets.ts": () => import("../connect_tickets.js"),
  "../connect_tickets_node.ts": () => import("../connect_tickets_node.js"),
  "../events.ts": () => import("../events.js"),
  "../health.ts": () => import("../health.js"),
  "../http.ts": () => import("../http.js"),
  "../instances.ts": () => import("../instances.js"),
  "../instances_node.ts": () => import("../instances_node.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../bundled_recipes.ts": () => import("../bundled_recipes.js"),
  "../agent_deletion.ts": () => import("../agent_deletion.js"),
  "../migrations.ts": () => import("../migrations.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
};

const PROJECT = "openclaw-recipe-first";
const TEMPLATE = "@acme/studio";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-rf", subject: "owner-rf" };
type T = ReturnType<typeof convexTest>;
type Owner = ReturnType<T["withIdentity"]>;

const V1_PROFILE = `schemaVersion: 1
category: marketing
mcpServers: []
missionTypes:
  - type: write_post
    agentsMd: write_post.md
    label: Write a post
    payload: '{"topic":""}'
    contextProviders:
      - production-recipe
  - type: moderate
    agentsMd: moderate.md
    label: Moderate comments
    payload: '{}'
`;

function studio(version: string): PackageFile[] {
  return withFile(readClawPackageFixture("studio"), "package.json", JSON.stringify({ name: TEMPLATE, version, openclaw: { claw: "CLAW.md" } }));
}
/** The same Template as it was shipped before ADR-091: no `kind`, no recipes, the provider declaration. */
function studioV1(): PackageFile[] {
  return withFile(studio("1.0.0"), "profiles/opengroow.yml", V1_PROFILE).filter((f) => !f.path.startsWith("recipes/"));
}

async function setup() {
  const t = convexTest(schema, modules);
  migrationsComponent.register(t);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-rf", status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: now, openclawId: PROJECT, updatedAt: now, userId: OWNER.subject });
    const ms = Date.now();
    await ctx.db.insert("projectAgents", { instanceId: PROJECT, templateId: TEMPLATE, status: "active", workspaceKey: "ws-rf", openclawAgentName: "studio", mcpServerKeys: [], createdAt: ms, updatedAt: ms });
  });
  return { t, owner: t.withIdentity(OWNER) };
}

const storeV1 = (t: T) => t.run((ctx) => storeOutdatedVersion(ctx, { projectId: PROJECT, files: studioV1(), origin: "hub" }));
const applyUpdate = (t: T, files: PackageFile[]) =>
  t.run(async (ctx) => {
    const offered = await offerTemplateUpdate(ctx, { projectId: PROJECT, files, origin: "hub" });
    await applyStagedUpdate(ctx, PROJECT, offered.templateId, offered.version);
  });

const ARTIFACT = { kind: "markdown" as const, external: { service: "article-mcp", id: "article-1" }, metadata: {} };
const RESULT = { status: "needs_human_review" as const, summary: "A post", reviewQuestions: [], artifact: ARTIFACT };

/** What a Project on v1 has accumulated: Missions without a recipe, a Mission with a Recipe Snapshot, Runs, Artifacts, a Publication, three Schedules. */
async function seedHistory(t: T) {
  return await t.run(async (ctx) => {
    const at = Date.UTC(2030, 0, 1);
    const customRecipe = await ctx.db.insert("productionRecipes", { instanceId: PROJECT, templateId: TEMPLATE, missionType: "write_post", name: "My hook", description: "Mine" });
    await ctx.db.insert("productionRecipeVersions", { instanceId: PROJECT, recipeId: customRecipe, version: 1, prompt: "A calm face", instructions: "Be calm", constraints: ["No dialogue"], createdAt: at });
    const mission = (extra: Partial<Doc<"missions">>) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, templateVersion: "1.0.0", type: "write_post", payload: { topic: "octopus" },
        status: "done", createdAt: at, updatedAt: at, ...extra,
      } as never);
    const run = (missionId: Id<"missions">, extra: Partial<Doc<"runs">>) =>
      ctx.db.insert("runs", {
        missionId, ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, agentName: "studio", sessionKey: `s-${missionId}`,
        status: "completed", result: RESULT, completedAt: at, createdAt: at, updatedAt: at, ...extra,
      } as never);

    const plain = await mission({ number: 1, lastResult: RESULT, lastArtifact: ARTIFACT });
    const plainRun = await run(plain, {});
    await ctx.db.patch(plain, { lastResultRunId: plainRun });
    await ctx.db.insert("publications", { missionId: plain, instanceId: PROJECT, target: "instagram:example", status: "published", externalId: "post-1", runId: plainRun, createdAt: at, updatedAt: at });

    const snapshot = { recipeId: customRecipe, recipeName: "My hook", version: 1, prompt: "A calm face", instructions: "Be calm", constraints: ["No dialogue"] };
    const withRecipe = await mission({ number: 2, status: "to_validate", recipeSnapshot: snapshot, lastResult: RESULT, lastArtifact: ARTIFACT });
    await run(withRecipe, {});
    const operational = await mission({ number: 3, type: "moderate", payload: {} });
    await run(operational, { result: { status: "success", summary: "Moderated" } as never });

    const schedule = (extra: Partial<Doc<"schedules">>) =>
      ctx.db.insert("schedules", {
        ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, type: "write_post", payload: { topic: "x" }, unit: "daily", hour: 9, minute: 0,
        timezone: "UTC", status: "active", nextRunAt: at + 10_000, createdAt: at, updatedAt: at, ...extra,
      } as never);
    return {
      customRecipe, plain, plainRun, withRecipe, operational, snapshot,
      recipeLess: await schedule({}),
      chosen: await schedule({ recipeId: customRecipe }),
      operationalSchedule: await schedule({ type: "moderate", payload: {} }),
    };
  });
}

const TABLES = ["missions", "runs", "publications", "productionRecipes", "productionRecipeVersions", "schedules", "projectCounters", "commands"] as const;
type Dump = Record<(typeof TABLES)[number], unknown[]>;
async function dump(t: T): Promise<Dump> {
  return await t.run(async (ctx) => {
    const out = {} as Dump;
    for (const table of TABLES) out[table] = await ctx.db.query(table).collect();
    return out;
  });
}
const idOf = (row: unknown) => (row as { _id: string })._id;

describe("a Project migrated from v1 to v2 in one Template update", () => {
  let ids: Awaited<ReturnType<typeof seedHistory>>;
  let t: T;
  let owner: Owner;
  let before: Dump;

  beforeEach(async () => {
    ({ t, owner } = await setup());
    await storeV1(t);
    ids = await seedHistory(t);
    before = await dump(t);
    await applyUpdate(t, studio("2.0.0"));
  });

  it("provisions the Bundled Recipes at Version 1, the Default marked, next to the existing Custom Recipe", async () => {
    const list = await owner.query(api.production_recipes.list, { instanceId: PROJECT });
    const bundled = list.filter((r) => r.origin === "bundled");
    expect(bundled.map((r) => [r.name, r.latestVersion, r.isDefault]).sort()).toEqual([["Freeform", 1, true], ["Punchy", 1, false]]);
    expect(list.find((r) => r._id === ids.customRecipe)).toMatchObject({ name: "My hook", origin: "custom" });
    expect(list).toHaveLength(3);
  });

  it("backfills the creative Schedule without a recipe with the Default, and leaves the others untouched", async () => {
    const freeform = (await owner.query(api.production_recipes.list, { instanceId: PROJECT })).find((r) => r.name === "Freeform")!._id;
    const [recipeLess, chosen, operational] = await t.run((ctx) => Promise.all([ids.recipeLess, ids.chosen, ids.operationalSchedule].map((id) => ctx.db.get(id))));
    expect(recipeLess!.recipeId).toBe(freeform);
    const untouched = (id: Id<"schedules">) => before.schedules.find((s) => idOf(s) === id);
    expect(chosen).toEqual(untouched(ids.chosen));
    expect(chosen!.recipeId).toBe(ids.customRecipe);
    expect(operational).toEqual(untouched(ids.operationalSchedule));
    expect(operational!.recipeId).toBeUndefined();
  });

  it("changes no historical row: Missions, Runs, Publications, Recipe Snapshots and the existing recipe are byte for byte the same", async () => {
    const after = await dump(t);
    for (const table of ["missions", "runs", "publications", "productionRecipeVersions", "projectCounters", "commands"] as const) {
      for (const row of before[table]) expect(after[table].find((r) => idOf(r) === idOf(row))).toEqual(row);
      if (table !== "productionRecipeVersions") expect(after[table]).toHaveLength(before[table].length);
    }
    expect(after.productionRecipes.find((r) => idOf(r) === ids.customRecipe)).toEqual(before.productionRecipes[0]);
    // Only the two Bundled Recipes and their first versions were added.
    expect(after.productionRecipes).toHaveLength(before.productionRecipes.length + 2);
    expect(after.productionRecipeVersions).toHaveLength(before.productionRecipeVersions.length + 2);
  });

  it("keeps the v1 version stored and the history readable: Missions, Artifacts, Runs, Publications and Recipe Snapshots", async () => {
    const stored = await t.run((ctx) => ctx.db.query("installedTemplates").collect());
    expect(stored.map((s) => [s.version, s.current])).toEqual(expect.arrayContaining([["1.0.0", false], ["2.0.0", true]]));

    const plain = await owner.query(api.missions.get, { missionId: ids.plain });
    expect(plain).toMatchObject({ templateVersion: "1.0.0", lastArtifact: ARTIFACT, status: "done" });
    expect(plain!.recipeSnapshot).toBeUndefined();
    expect((await owner.query(api.missions.get, { missionId: ids.withRecipe }))!.recipeSnapshot).toEqual(ids.snapshot);

    const runs = await owner.query(api.runs.listByMission, { missionId: ids.plain });
    expect(runs.map((r) => [r._id, r.result && "artifact" in r.result ? r.result.artifact : undefined])).toEqual([[ids.plainRun, ARTIFACT]]);
    const publications = await owner.query(api.publications.listForMission, { missionId: ids.plain });
    expect(publications).toMatchObject([{ target: "instagram:example", status: "published", externalId: "post-1" }]);

    const done = await owner.query(api.missions.listDoneByInstance, { instanceId: PROJECT, paginationOpts: { numItems: 10, cursor: null } });
    expect(done.page.map((m) => m._id)).toEqual(expect.arrayContaining([ids.plain, ids.operational]));
    expect(JSON.stringify(await owner.query(api.missions.listActiveByInstance, { instanceId: PROJECT }))).toContain(ids.withRecipe);
  });

  it("is idempotent: provisioning again adds no recipe and changes no Schedule", async () => {
    const once = await dump(t);
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    expect(await dump(t)).toEqual(once);
  });
});

describe("a Run in progress when the Project switches", () => {
  it("completes normally, and its Mission, pinned to the v1 version, still reaches review", async () => {
    const { t, owner } = await setup();
    await storeV1(t);
    const { missionId, runId } = await t.run(async (ctx) => {
      const now = Date.now();
      const mission = await ctx.db.insert("missions", { ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, templateVersion: "1.0.0", type: "write_post", payload: {}, status: "doing", createdAt: now, updatedAt: now });
      const run = await ctx.db.insert("runs", { missionId: mission, ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, agentName: "studio", sessionKey: "s-live", status: "running", createdAt: now, updatedAt: now });
      return { missionId: mission, runId: run };
    });

    await applyUpdate(t, studio("2.0.0"));
    await t.mutation(internal.runs.markCompleted, { runId, result: RESULT });

    expect(await owner.query(api.runs.get, { runId })).toMatchObject({ status: "completed" });
    expect(await owner.query(api.missions.get, { missionId })).toMatchObject({ status: "to_validate", templateVersion: "1.0.0", lastArtifact: ARTIFACT });
  });
});

describe("approving and publishing content already produced on an outdated version", () => {
  const INSTANCE = "openclaw-recipe-first-pub";
  const IMAGE_TEMPLATE = "@test/image-maker";
  const imageMaker = fixtureTemplate(IMAGE_TEMPLATE, {
    schemaVersion: 1,
    missionTypes: [{
      type: "make_image",
      publish: { kind: "image" },
      review: {
        kind: "image",
        service: "workspace",
        actions: [
          { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
          { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
        ],
      },
    }],
  } as never);

  beforeEach(() => setTemplateRegistryForTests(inMemoryRegistry([INSTANCE], [imageMaker])));
  afterEach(() => {
    setTemplateRegistryForTests(undefined);
    vi.unstubAllGlobals();
  });

  it("stay available: the Template is outdated, the Mission still goes from review to approved to done", async () => {
    const t = convexTest(schema, modules);
    await installPostiz(t);
    await t.run((ctx) => insertInstance(ctx, { jobId: "job-pub", status: "running", createdAt: new Date().toISOString(), openclawId: INSTANCE, updatedAt: new Date().toISOString(), userId: OWNER.subject }));
    const as = t.withIdentity(OWNER);
    await as.mutation(api.publishers.save, { instanceId: INSTANCE, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
    await as.mutation(api.publishers.addChannel, { instanceId: INSTANCE, adapter: "postiz", channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "example" });
    const now = Date.now();
    const missionId = await t.run((ctx) => ctx.db.insert("missions", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: IMAGE_TEMPLATE, type: "make_image", payload: { publishTargets: ["instagram:example"] }, status: "to_validate",
      lastResult: { status: "needs_human_review", summary: "Ready", reviewQuestions: [], artifact: { external: { service: "media", id: "42" }, publishable: { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello" } } },
      createdAt: now, updatedAt: now,
    } as never));
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url).replace("https://postiz.example.com/api/public/v1/", "");
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (path === "integrations") return json([{ id: "ch-1", name: "My IG", identifier: "instagram" }]);
      if (path === "upload-from-url") return json({ id: "media-1", path: "https://postiz.example.com/uploads/1" });
      if (path === "posts" && init?.method === "POST") return json([{ postId: "post-1", integration: "ch-1" }]);
      return new Response("{}", { status: 404 });
    }));

    await as.action(api.missions_node.performReviewAction, { missionId, actionKey: "approve" });
    expect((await as.query(api.missions.get, { missionId }))?.status).toBe("approved");
    await as.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect((await as.query(api.missions.get, { missionId }))?.status).toBe("done");
    expect(await as.query(api.publications.listForMission, { missionId })).toMatchObject([{ status: "published", externalId: "post-1" }]);
  });
});

describe("a refused Mission creation leaves no persistent side effect", () => {
  const create = (owner: Owner, type: string, recipe?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    owner.mutation(api.missions.create, { instanceId: PROJECT, templateId: TEMPLATE, type, payload: { topic: "x" }, ...(recipe ? { recipe } : {}), ...extra } as never);

  it("across every refusal case: no Mission, Run, counter, command, snapshot or recipe is written", async () => {
    const { t, owner } = await setup();
    await storeV1(t);
    await applyUpdate(t, studio("2.0.0"));
    const freeform = (await owner.query(api.production_recipes.list, { instanceId: PROJECT })).find((r) => r.name === "Freeform")!._id;
    const { foreign, wrongType, deleted } = await t.run(async (ctx) => {
      const row = (extra: Partial<Doc<"productionRecipes">>) =>
        ctx.db.insert("productionRecipes", { instanceId: PROJECT, templateId: TEMPLATE, missionType: "write_post", name: "R", description: "d", ...extra });
      const result = { foreign: await row({ instanceId: "another-project" }), wrongType: await row({ missionType: "moderate" }), deleted: await row({}) };
      await ctx.db.delete(result.deleted);
      return result;
    });
    // An outdated Template with an active Agent: refused where the Run would be inserted, after the counter was read.
    await t.run(async (ctx) => {
      await storeOutdatedVersion(ctx, { projectId: PROJECT, files: readClawPackageFixture("legacy") });
      const ms = Date.now();
      await ctx.db.insert("projectAgents", { instanceId: PROJECT, templateId: "@acme/legacy", status: "active", workspaceKey: "ws-legacy", openclawAgentName: "legacy", mcpServerKeys: [], createdAt: ms, updatedAt: ms });
    });

    const cases: [string, () => Promise<unknown>][] = [
      ["no recipe for a creative type", () => create(owner, "write_post")],
      ["a recipe for an operational type", () => create(owner, "moderate", { recipeId: freeform })],
      ["a recipe of another Mission type", () => create(owner, "write_post", { recipeId: wrongType })],
      ["a recipe of another Project", () => create(owner, "write_post", { recipeId: foreign })],
      ["a deleted recipe", () => create(owner, "write_post", { recipeId: deleted })],
      ["an unknown recipe version", () => create(owner, "write_post", { recipeId: freeform, version: 9 })],
      ["an unknown Mission type", () => create(owner, "nope", { recipeId: freeform })],
      ["a Template version that is not installed", () => create(owner, "write_post", { recipeId: freeform }, { templateVersion: "9.9.9" })],
      ["an outdated Template", () => owner.mutation(api.missions.create, { instanceId: PROJECT, templateId: "@acme/legacy", type: "write_post", payload: {} } as never)],
    ];
    const base = await dump(t);
    for (const [label, attempt] of cases) {
      await expect(attempt(), label).rejects.toThrow();
      expect(await dump(t), label).toEqual(base);
    }
  });

  it("creates no recipe either in a Project that has not migrated yet", async () => {
    const { t, owner } = await setup();
    await storeV1(t);
    const base = await dump(t);
    await expect(create(owner, "write_post")).rejects.toThrow();
    expect(await dump(t)).toEqual(base);
    expect(base.productionRecipes).toEqual([]);
  });
});

describe("recipes survive deleting an Agent", () => {
  it("through the real Agent deletion, and reinstalling the Template reuses them without a duplicate", async () => {
    const { t, owner } = await setup();
    await storeV1(t);
    await applyUpdate(t, studio("2.0.0"));
    const before = await owner.query(api.production_recipes.list, { instanceId: PROJECT });
    expect(before).toHaveLength(2);

    const agentId = (await t.run((ctx) => ctx.db.query("projectAgents").first()))!._id;
    await t.run((ctx) => ctx.db.patch(agentId, { status: "inactive" }));
    for (let step = 0; step < 20; step++) {
      const { done } = await t.mutation(internal.agent_deletion.purgeBatch, { instanceId: PROJECT, templateId: TEMPLATE });
      if (done) break;
    }
    expect(await t.run((ctx) => ctx.db.query("installedTemplates").collect())).toHaveLength(0);
    expect(await owner.query(api.production_recipes.list, { instanceId: PROJECT })).toEqual(before);

    await t.run((ctx) => installTemplatePackage(ctx, { projectId: PROJECT, files: studio("2.0.0"), origin: "hub" }));
    const after = await owner.query(api.production_recipes.list, { instanceId: PROJECT });
    expect(after).toEqual(before);
  });
});
