import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplatePackage, offerTemplateUpdate, applyStagedUpdate } from "../template_registry_store";
import { readClawPackageFixture, withFile, type PackageFile } from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Schedules carry their Production Recipe (ADR-091): required for a creative Mission type, used by the tick, backfilled
// with the Default, and paused with a reason when the recipe goes away.
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
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../project_agents_node.ts": () => import("../project_agents_node.js"),
  "../runtime_commands_node.ts": () => import("../runtime_commands_node.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../schedule_outdated.ts": () => import("../schedule_outdated.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../bundled_recipes.ts": () => import("../bundled_recipes.js"),
};

const PROJECT = "openclaw-schedule-recipes";
const TEMPLATE = "@acme/studio";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-sr", subject: "owner-sr" };
const DAILY = { unit: "daily" as const, hour: 9, minute: 0 };
type T = ReturnType<typeof convexTest>;
type Owner = ReturnType<T["withIdentity"]>;

function studio(version = "1.0.0", profile?: (p: string) => string): PackageFile[] {
  let files = withFile(readClawPackageFixture("studio"), "package.json", JSON.stringify({ name: TEMPLATE, version, openclaw: { claw: "CLAW.md" } }));
  if (profile) files = withFile(files, "profiles/opengroow.yml", profile(files.find((f) => f.path === "profiles/opengroow.yml")!.content));
  return files;
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-sr", status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: now, openclawId: PROJECT, updatedAt: now, userId: OWNER.subject });
    const ms = Date.now();
    await ctx.db.insert("projectAgents", {
      instanceId: PROJECT, templateId: TEMPLATE, status: "active", workspaceKey: "ws-sr", openclawAgentName: "studio", mcpServerKeys: [], createdAt: ms, updatedAt: ms,
    });
  });
  await t.run((ctx) => installTemplatePackage(ctx, { projectId: PROJECT, files: studio(), origin: "hub" }));
  return { t, owner: t.withIdentity(OWNER) };
}

const update = (t: T, files: PackageFile[]) =>
  t.run(async (ctx) => {
    const offered = await offerTemplateUpdate(ctx, { projectId: PROJECT, files, origin: "hub" });
    await applyStagedUpdate(ctx, PROJECT, offered.templateId, offered.version);
  });

async function recipeIds(owner: Owner) {
  const list = await owner.query(api.production_recipes.list, { instanceId: PROJECT });
  const by = (name: string) => list.find((r) => r.name === name)!._id;
  return { freeform: by("Freeform"), punchy: by("Punchy") };
}

const create = (owner: Owner, extra: Record<string, unknown> = {}, type = "write_post") =>
  owner.mutation(api.schedules.create, { instanceId: PROJECT, templateId: TEMPLATE, type, payload: { topic: "x" }, frequency: DAILY, timezone: "UTC", ...extra } as never);

const getSchedule = (t: T, id: Id<"schedules">) => t.run((ctx) => ctx.db.get(id));

/** A Schedule as it existed before Schedules carried a recipe. */
const seedLegacy = (t: T, type = "write_post") =>
  t.run((ctx) =>
    ctx.db.insert("schedules", {
      ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, type, payload: { topic: "x" }, unit: "daily", hour: 9, minute: 0,
      timezone: "UTC", status: "active", nextRunAt: Date.now() - 1000, createdAt: Date.now(), updatedAt: Date.now(),
    }),
  );

describe("creating a creative Schedule", () => {
  it("is refused without a recipe, and accepted with a compatible one", async () => {
    const { owner } = await setup();
    const ids = await recipeIds(owner);
    await expect(create(owner)).rejects.toThrow(/Production Recipe/);
    const { scheduleId } = await create(owner, { recipeId: ids.freeform });
    expect((await owner.query(api.schedules.listByInstance, { instanceId: PROJECT }))[0]).toMatchObject({ _id: scheduleId, recipeId: ids.freeform });
  });

  it("is refused with a recipe of another Project", async () => {
    const { t, owner } = await setup();
    const foreign = await t.run(async (ctx) =>
      ctx.db.insert("productionRecipes", { instanceId: "another-project", templateId: TEMPLATE, missionType: "write_post", name: "F", description: "d" }),
    );
    await expect(create(owner, { recipeId: foreign })).rejects.toThrow(/not found/);
  });

  it("an operational Mission type needs no recipe and takes none", async () => {
    const { owner } = await setup();
    const ids = await recipeIds(owner);
    await expect(create(owner, {}, "moderate")).resolves.toBeDefined();
    await expect(create(owner, { recipeId: ids.freeform }, "moderate")).rejects.toThrow(/takes no/);
  });

  it("default Schedules record the Default Recipe explicitly", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    await t.mutation(internal.schedules.createDefaults, {
      ownerId: OWNER.subject, instanceId: PROJECT, templateId: TEMPLATE, timezone: "UTC",
      defaults: [{ type: "write_post", payload: {}, frequency: DAILY }, { type: "moderate", payload: {}, frequency: DAILY }],
    });
    const schedules = await owner.query(api.schedules.listByInstance, { instanceId: PROJECT });
    expect(schedules.find((s) => s.type === "write_post")!.recipeId).toBe(ids.freeform);
    expect(schedules.find((s) => s.type === "moderate")!.recipeId).toBeUndefined();
  });
});

describe("the tick", () => {
  it("creates the Mission with the Schedule's recipe", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const { scheduleId } = await create(owner, { recipeId: ids.punchy });
    await t.run((ctx) => ctx.db.patch(scheduleId, { nextRunAt: Date.now() - 1000 }));
    await t.action(internal.schedules.tick, {});
    const missions = await t.run((ctx) => ctx.db.query("missions").collect());
    expect(missions).toHaveLength(1);
    expect(missions[0]!.recipeSnapshot).toMatchObject({ recipeId: ids.punchy, recipeName: "Punchy" });
  });

  it("creates no Mission for a creative Schedule that has no recipe", async () => {
    const { t } = await setup();
    const id = await seedLegacy(t);
    await t.action(internal.schedules.tick, {});
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);
    expect((await getSchedule(t, id))!.lastError).toMatch(/Production Recipe/);
  });
});

describe("Run now", () => {
  it("creates the Mission with the recipe stored on the Schedule", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const { scheduleId } = await create(owner, { recipeId: ids.punchy });
    await owner.mutation(api.schedules.runNow, { scheduleId });
    const missions = await t.run((ctx) => ctx.db.query("missions").collect());
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ type: "write_post", recipeSnapshot: { recipeId: ids.punchy } });
  });

  it("is refused for a creative Schedule without a recipe", async () => {
    const { t, owner } = await setup();
    const id = await seedLegacy(t);
    await expect(owner.mutation(api.schedules.runNow, { scheduleId: id })).rejects.toThrow(/Production Recipe/);
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);
  });

  it("is refused for the Schedule of another owner", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const { scheduleId } = await create(owner, { recipeId: ids.freeform });
    const stranger = t.withIdentity({ name: "S", email: "s@example.com", tokenIdentifier: "test|stranger", subject: "stranger" });
    await expect(stranger.mutation(api.schedules.runNow, { scheduleId })).rejects.toThrow(/Forbidden/);
  });
});

describe("the backfill", () => {
  it("gives a recipe-less creative Schedule the Default, idempotently, and leaves a compatible recipe untouched", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const legacy = await seedLegacy(t);
    const operational = await seedLegacy(t, "moderate");
    const { scheduleId: chosen } = await create(owner, { recipeId: ids.punchy });
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    expect((await getSchedule(t, legacy))!.recipeId).toBe(ids.freeform);
    expect((await getSchedule(t, operational))!.recipeId).toBeUndefined();
    expect((await getSchedule(t, chosen))!.recipeId).toBe(ids.punchy);
  });

  it("runs when the Project applies the Template version", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const legacy = await seedLegacy(t);
    await update(t, studio("1.1.0"));
    expect((await getSchedule(t, legacy))!.recipeId).toBe(ids.freeform);
  });
});

describe("a recipe that goes away", () => {
  async function withSchedule() {
    const ctx = await setup();
    const { recipeId } = await ctx.owner.mutation(api.production_recipes.create, {
      instanceId: PROJECT, templateId: TEMPLATE, missionType: "write_post", name: "Mine", description: "d", instructions: "i", constraints: [],
    });
    const { scheduleId } = await create(ctx.owner, { recipeId });
    return { ...ctx, recipeId, scheduleId };
  }

  it("lists the affected Schedules in the deletion impact, then pauses them with the reason", async () => {
    const { t, owner, recipeId, scheduleId } = await withSchedule();
    const impact = await owner.query(api.production_recipes.deletionImpact, { instanceId: PROJECT, recipeId });
    expect(impact!.schedules).toEqual([{ scheduleId, type: "write_post" }]);
    await owner.mutation(api.production_recipes.remove, { instanceId: PROJECT, recipeId });
    expect(await getSchedule(t, scheduleId)).toMatchObject({ status: "paused", pausedReason: "recipe unavailable" });
    expect((await getSchedule(t, scheduleId))!.recipeId).toBeUndefined();
  });

  it("refuses resuming until a compatible recipe is set; then the reason clears and the Schedule stays paused", async () => {
    const { t, owner, recipeId, scheduleId } = await withSchedule();
    const ids = await recipeIds(owner);
    await owner.mutation(api.production_recipes.remove, { instanceId: PROJECT, recipeId });
    await expect(owner.mutation(api.schedules.resume, { scheduleId })).rejects.toThrow(/recipe/i);
    // The Default never takes over silently.
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    expect(await getSchedule(t, scheduleId)).toMatchObject({ status: "paused", pausedReason: "recipe unavailable" });
    expect((await getSchedule(t, scheduleId))!.recipeId).toBeUndefined();

    await owner.mutation(api.schedules.setRecipe, { scheduleId, recipeId: ids.freeform });
    const fixed = (await getSchedule(t, scheduleId))!;
    expect(fixed).toMatchObject({ status: "paused", recipeId: ids.freeform });
    expect(fixed.pausedReason).toBeUndefined();
    await owner.mutation(api.schedules.resume, { scheduleId });
    expect((await getSchedule(t, scheduleId))!.status).toBe("active");
  });

  it("pauses the Schedules of a recipe whose Mission type stops being creative", async () => {
    const { t, owner } = await setup();
    const ids = await recipeIds(owner);
    const { scheduleId } = await create(owner, { recipeId: ids.freeform });
    await update(
      t,
      studio("2.0.0", (p) =>
        p
          .replace(/(- type: write_post\n\s+)kind: creative/, "$1kind: operational")
          .replace(/ {4}recipes:\n( {6}.*\n)+(?= {2}- type: moderate)/, ""),
      ),
    );
    expect(await getSchedule(t, scheduleId)).toMatchObject({ status: "paused", pausedReason: "recipe unavailable" });
  });
});
