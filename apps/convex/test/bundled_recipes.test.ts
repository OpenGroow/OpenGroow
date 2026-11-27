import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { installTemplatePackage, offerTemplateUpdate, applyStagedUpdate, listUpdateOffers } from "../template_registry_store";
import {
  readClawPackageFixture,
  withFile,
  type PackageFile,
} from "../../../packages/agent-templates/src/__fixtures__/claw-package";

// Bundled Recipes (ADR-091): provisioned on install and update, protected from edits, kept when an Agent goes.
const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../bundled_recipes.ts": () => import("../bundled_recipes.js"),
  "../agent_deletion.ts": () => import("../agent_deletion.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

const PROJECT = "openclaw-bundled-recipes";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-bundled", subject: "owner-bundled" };
const TEMPLATE = "@acme/studio";
type T = ReturnType<typeof convexTest>;

const PUNCHY_ENTRY = "      - id: punchy\n        path: recipes/write_post/punchy.yml\n";

/** The studio fixture at a version, with optional edits to its profile and recipe files. */
function studio(version = "1.0.0", edit: { profile?: (profile: string) => string; files?: Record<string, string | null> } = {}): PackageFile[] {
  let files = withFile(readClawPackageFixture("studio"), "package.json", JSON.stringify({ name: TEMPLATE, version, openclaw: { claw: "CLAW.md" } }));
  if (edit.profile) {
    files = withFile(files, "profiles/opengroow.yml", edit.profile(files.find((f) => f.path === "profiles/opengroow.yml")!.content));
  }
  for (const [path, content] of Object.entries(edit.files ?? {})) {
    files = content === null ? files.filter((f) => f.path !== path) : withFile(files, path, content);
  }
  return files;
}

const withoutPunchy = (version: string) =>
  studio(version, { profile: (p) => p.replace(PUNCHY_ENTRY, ""), files: { "recipes/write_post/punchy.yml": null } });

async function setup() {
  const t = convexTest(schema, modules);
  migrationsComponent.register(t);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-bundled", status: "running", createdAt: now, openclawId: PROJECT, updatedAt: now, userId: OWNER.subject });
  });
  return { t, owner: t.withIdentity(OWNER) };
}

const install = (t: T, files: PackageFile[], origin: "local_folder" | "hub" | "git" | "linked_folder" = "hub") =>
  t.run((ctx) => installTemplatePackage(ctx, { projectId: PROJECT, files, origin }));
const update = (t: T, files: PackageFile[]) =>
  t.run(async (ctx) => {
    const offered = await offerTemplateUpdate(ctx, { projectId: PROJECT, files, origin: "hub" });
    await applyStagedUpdate(ctx, PROJECT, offered.templateId, offered.version);
  });

async function recipes(owner: ReturnType<T["withIdentity"]>) {
  return await owner.query(api.production_recipes.list, { instanceId: PROJECT });
}
const byName = <R extends { name: string }>(list: R[], name: string) => list.find((r) => r.name === name)!;

describe("provisioning", () => {
  it.each(["local_folder", "hub", "git", "linked_folder"] as const)("a %s install adds the Bundled Recipes, the Default marked", async (origin) => {
    const { t, owner } = await setup();
    await install(t, studio(), origin);
    const list = await recipes(owner);
    expect(list.map((r) => [r.name, r.origin, r.isDefault, r.latestVersion, r.missionType])).toEqual(
      expect.arrayContaining([
        ["Freeform", "bundled", true, 1, "write_post"],
        ["Punchy", "bundled", false, 1, "write_post"],
      ]),
    );
    expect(list).toHaveLength(2);
  });

  it("provisioning twice changes nothing", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const before = await recipes(owner);
    await install(t, studio());
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    expect(await recipes(owner)).toEqual(before);
  });

  it("an update with unchanged files adds no Recipe Version; a changed file adds exactly one", async () => {
    const { t, owner } = await setup();
    await install(t, studio("1.0.0"));
    await update(t, studio("1.1.0"));
    expect((await recipes(owner)).map((r) => r.latestVersion)).toEqual([1, 1]);

    const changed = readClawPackageFixture("studio").find((f) => f.path === "recipes/write_post/punchy.yml")!.content.replace("fifteen", "twelve");
    await update(t, studio("1.2.0", { files: { "recipes/write_post/punchy.yml": changed } }));
    const list = await recipes(owner);
    expect(byName(list, "Punchy").latestVersion).toBe(2);
    expect(byName(list, "Freeform").latestVersion).toBe(1);
    const versions = await owner.query(api.production_recipes.listVersions, { instanceId: PROJECT, recipeId: byName(list, "Punchy")._id });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.instructions).toContain("twelve");
    expect(versions[1]!.instructions).toContain("fifteen");
  });

  it("activation provisions the recipes a Project does not have", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    await t.run(async (ctx) => {
      for (const recipe of await ctx.db.query("productionRecipes").collect()) {
        for (const version of await ctx.db.query("productionRecipeVersions").collect()) await ctx.db.delete(version._id);
        await ctx.db.delete(recipe._id);
      }
    });
    expect(await recipes(owner)).toHaveLength(0);
    await t.mutation(internal.bundled_recipes.provisionCurrent, { projectId: PROJECT, templateId: TEMPLATE });
    expect(await recipes(owner)).toHaveLength(2);
  });

  it("the backfill covers an existing Project", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    await t.run(async (ctx) => {
      for (const version of await ctx.db.query("productionRecipeVersions").collect()) await ctx.db.delete(version._id);
      for (const recipe of await ctx.db.query("productionRecipes").collect()) await ctx.db.delete(recipe._id);
    });
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.provisionBundledRecipes));
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.provisionBundledRecipes));
    const list = await recipes(owner);
    expect(list.map((r) => r.name).sort()).toEqual(["Freeform", "Punchy"]);
    expect(list.map((r) => r.latestVersion)).toEqual([1, 1]);
  });

  it("a Template version below 2 provisions nothing", async () => {
    const { t, owner } = await setup();
    await install(t, readClawPackageFixture("legacy"));
    expect(await recipes(owner)).toHaveLength(0);
  });
});

describe("a Bundled Recipe a new version no longer ships", () => {
  it("becomes a Custom Recipe, not Default, keeping its identity and versions, and the update plan shows it", async () => {
    const { t, owner } = await setup();
    await install(t, studio("1.0.0"));
    const punchy = byName(await recipes(owner), "Punchy");

    await t.run(async (ctx) => {
      await offerTemplateUpdate(ctx, { projectId: PROJECT, files: withoutPunchy("2.0.0"), origin: "hub" });
    });
    const [offer] = await t.run((ctx) => listUpdateOffers(ctx, PROJECT));
    expect(offer!.plan.recipesBecomingCustom).toEqual([{ missionType: "write_post", id: "punchy", name: "Punchy" }]);
    expect(offer!.plan.requiresAttention).toBe(true);
    // Offering changes nothing yet.
    expect(byName(await recipes(owner), "Punchy").origin).toBe("bundled");

    await t.run((ctx) => applyStagedUpdate(ctx, PROJECT, TEMPLATE, "2.0.0"));
    const list = await recipes(owner);
    expect(list).toHaveLength(2);
    expect(byName(list, "Punchy")).toMatchObject({ _id: punchy._id, origin: "custom", isDefault: false, latestVersion: 1 });
    expect(byName(list, "Freeform")).toMatchObject({ origin: "bundled", isDefault: true });
  });

  it("a Custom Recipe is never overwritten, and a returning Bundled Recipe is a new row", async () => {
    const { t, owner } = await setup();
    await install(t, studio("1.0.0"));
    const retiredId = byName(await recipes(owner), "Punchy")._id;
    await update(t, withoutPunchy("2.0.0"));
    // The user now owns it and edits it.
    await owner.mutation(api.production_recipes.saveVersion, { instanceId: PROJECT, recipeId: retiredId, instructions: "My own take.", constraints: [] });

    await update(t, studio("3.0.0"));
    const list = (await recipes(owner)).filter((r) => r.name === "Punchy");
    expect(list).toHaveLength(2);
    const custom = list.find((r) => r._id === retiredId)!;
    expect(custom).toMatchObject({ origin: "custom", latestVersion: 2 });
    const returned = list.find((r) => r._id !== retiredId)!;
    expect(returned).toMatchObject({ origin: "bundled", latestVersion: 1 });
    const got = await owner.query(api.production_recipes.get, { instanceId: PROJECT, recipeId: retiredId });
    expect(got?.latest?.instructions).toBe("My own take.");
  });
});

describe("protection of a Bundled Recipe", () => {
  it("refuses editing, retargeting and deleting it", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const freeform = byName(await recipes(owner), "Freeform");
    const ids = { instanceId: PROJECT, recipeId: freeform._id };
    await expect(owner.mutation(api.production_recipes.saveVersion, { ...ids, instructions: "x", constraints: [] })).rejects.toThrow(/Bundled Recipe/);
    await expect(owner.mutation(api.production_recipes.setTarget, { ...ids, templateId: TEMPLATE, missionType: "write_post" })).rejects.toThrow(/Bundled Recipe/);
    await expect(owner.mutation(api.production_recipes.remove, ids)).rejects.toThrow(/Bundled Recipe/);
    const after = await recipes(owner);
    expect(after).toHaveLength(2);
    expect(byName(after, "Freeform").latestVersion).toBe(1);
  });

  it("duplicating creates an independent Custom Recipe with no link", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const punchy = byName(await recipes(owner), "Punchy");
    const { recipeId } = await owner.mutation(api.production_recipes.duplicate, { instanceId: PROJECT, recipeId: punchy._id });
    const copy = (await owner.query(api.production_recipes.get, { instanceId: PROJECT, recipeId }))!;
    expect(copy).toMatchObject({ origin: "custom", isDefault: false, missionType: "write_post", templateId: TEMPLATE, name: "Punchy (copy)" });
    expect(copy.latest).toMatchObject({ version: 1, prompt: "Open with the most surprising fact.", constraints: ["No more than 120 words", "No emoji"] });

    await owner.mutation(api.production_recipes.saveVersion, { instanceId: PROJECT, recipeId, instructions: "Changed.", constraints: [] });
    // The Template's update neither touches the copy nor is touched by it.
    const changed = readClawPackageFixture("studio").find((f) => f.path === "recipes/write_post/punchy.yml")!.content.replace("fifteen", "ten");
    await update(t, studio("1.1.0", { files: { "recipes/write_post/punchy.yml": changed } }));
    const list = await recipes(owner);
    expect(byName(list, "Punchy")).toMatchObject({ origin: "bundled", latestVersion: 2 });
    expect(byName(list, "Punchy (copy)")).toMatchObject({ origin: "custom", latestVersion: 2 });
    // A copy of a Bundled Recipe can be deleted.
    await owner.mutation(api.production_recipes.remove, { instanceId: PROJECT, recipeId });
    expect(await recipes(owner)).toHaveLength(2);
  });

  it("a Custom Recipe can still be edited and deleted", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const { recipeId } = await owner.mutation(api.production_recipes.create, {
      instanceId: PROJECT, templateId: TEMPLATE, missionType: "write_post", name: "Mine", description: "d", instructions: "i", constraints: [],
    });
    await owner.mutation(api.production_recipes.saveVersion, { instanceId: PROJECT, recipeId, instructions: "j", constraints: [] });
    await owner.mutation(api.production_recipes.remove, { instanceId: PROJECT, recipeId });
    expect(await recipes(owner)).toHaveLength(2);
  });
});

describe("creating a recipe", () => {
  it("still needs a Template and a compatible (creative) Mission type", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const base = { instanceId: PROJECT, name: "Mine", description: "d", instructions: "i", constraints: [] };
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: TEMPLATE, missionType: "moderate" })).rejects.toThrow(/not creative/);
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: TEMPLATE, missionType: "unknown" })).rejects.toThrow(/does not exist/);
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@acme/missing", missionType: "write_post" })).rejects.toThrow(/not installed/);
    const targets = await owner.query(api.production_recipes.listTargets, { instanceId: PROJECT });
    expect(targets.map((x) => x.missionType)).toEqual(["write_post"]);
  });
});

describe("deleting an Agent", () => {
  it("deletes no recipe, and reinstalling the Template reuses them", async () => {
    const { t, owner } = await setup();
    await install(t, studio());
    const before = await recipes(owner);
    // Another recipe the user made.
    await owner.mutation(api.production_recipes.create, {
      instanceId: PROJECT, templateId: TEMPLATE, missionType: "write_post", name: "Mine", description: "d", instructions: "i", constraints: [],
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectAgents", { instanceId: PROJECT, templateId: TEMPLATE, status: "inactive", workspaceKey: "ws", mcpServerKeys: [], createdAt: now, updatedAt: now });
    });
    for (let step = 0; step < 20; step++) {
      const { done } = await t.mutation(internal.agent_deletion.purgeBatch, { instanceId: PROJECT, templateId: TEMPLATE });
      if (done) break;
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("installedTemplates").collect()).toHaveLength(0);
    });
    const kept = await recipes(owner);
    expect(kept).toHaveLength(3);

    await install(t, studio());
    const reinstalled = await recipes(owner);
    expect(reinstalled).toHaveLength(3);
    for (const recipe of before) expect(reinstalled.find((r) => r._id === recipe._id)).toMatchObject({ origin: "bundled", latestVersion: 1 });
  });
});
