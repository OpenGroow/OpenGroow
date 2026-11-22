import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry } from "./helpers/template_registry.helpers";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
};

const INSTANCE_ID = "instance-rec";
const OTHER_INSTANCE_ID = "instance-rec-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-rec", subject: "owner-rec" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-rec", subject: "stranger-rec" };

beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], []);
});
afterEach(() => restoreRegistry());

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-a", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-b", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
}

const family = (t: T, instanceId = INSTANCE_ID, fields: Record<string, unknown> = {}) =>
  t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId, slug: `s-${Math.random()}`, name: "Family", description: "Mechanic", ...fields } as never));

const content = {
  prompt: "A {MOOD} reaction.",
  instructions: "Keep it {MOOD}.",
  constraints: ["No dialogue", "  "],
  variables: [{ name: "MOOD", values: ["delighted", "calm"], default: "delighted" }],
};

async function setup() {
  const t = convexTest(schema, modules);
  await seed(t);
  const familyId = await family(t);
  const owner = t.withIdentity(OWNER);
  const created = await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "Recipe A", description: "d", ...content });
  return { t, owner, familyId, ...created };
}

describe("production_recipes", () => {
  it("creates a recipe with version 1 and cleans blank constraints", async () => {
    const { owner, recipeId, version } = await setup();
    expect(version).toBe(1);
    const got = await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId });
    expect(got).toMatchObject({ name: "Recipe A", status: "active", latest: { version: 1, constraints: ["No dialogue"] } });
  });

  it("appends versions and never modifies a saved one", async () => {
    const { owner, recipeId } = await setup();
    const v2 = await owner.mutation(api.production_recipes.saveVersion, {
      instanceId: INSTANCE_ID, recipeId, ...content, prompt: "Another {MOOD} take.",
    });
    expect(v2).toBe(2);
    const versions = await owner.query(api.production_recipes.listVersions, { instanceId: INSTANCE_ID, recipeId });
    expect(versions.map((x) => x.version)).toEqual([2, 1]);
    expect(versions[1]!.prompt).toBe("A {MOOD} reaction.");
    expect(versions[0]!.prompt).toBe("Another {MOOD} take.");
  });

  it("rejects a placeholder without variable and a default outside the values, at create and save", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "B", description: "", ...content, prompt: "{NOPE}" })).rejects.toThrow("{NOPE}");
    await expect(
      owner.mutation(api.production_recipes.saveVersion, {
        instanceId: INSTANCE_ID, recipeId, ...content, variables: [{ name: "MOOD", values: ["calm"], default: "delighted" }],
      }),
    ).rejects.toThrow("not one of its values");
    const count = await t.run(async (ctx) => (await ctx.db.query("productionRecipeVersions").collect()).length);
    expect(count).toBe(1);
  });

  it("archives keeping history, refuses edits, and unarchives", async () => {
    const { owner, familyId, recipeId } = await setup();
    await owner.mutation(api.production_recipes.archive, { instanceId: INSTANCE_ID, recipeId });
    const [row] = await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID, familyId });
    expect(row).toMatchObject({ status: "archived", latestVersion: 1 });
    expect(await owner.query(api.production_recipes.listVersions, { instanceId: INSTANCE_ID, recipeId })).toHaveLength(1);
    await expect(owner.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content })).rejects.toThrow("archived");
    await owner.mutation(api.production_recipes.unarchive, { instanceId: INSTANCE_ID, recipeId });
    expect((await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId }))!.status).toBe("active");
  });

  it("refuses to create under an archived family or another Instance's family", async () => {
    const { t, owner } = await setup();
    const archived = await family(t, INSTANCE_ID, { status: "archived" });
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId: archived, name: "X", description: "", ...content })).rejects.toThrow("archived");
    const foreign = await family(t, OTHER_INSTANCE_ID);
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId: foreign, name: "X", description: "", ...content })).rejects.toThrow("not found");
  });

  it("isolates recipes per Project", async () => {
    const { t, recipeId, familyId } = await setup();
    const stranger = t.withIdentity(STRANGER);
    // Stranger cannot act on the owner's Instance.
    await expect(stranger.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content })).rejects.toThrow();
    expect(await stranger.query(api.production_recipes.list, { instanceId: INSTANCE_ID, familyId })).toEqual([]);
    // Nor reach it through their own Instance.
    expect(await stranger.query(api.production_recipes.get, { instanceId: OTHER_INSTANCE_ID, recipeId })).toBeNull();
    expect(await stranger.query(api.production_recipes.listVersions, { instanceId: OTHER_INSTANCE_ID, recipeId })).toEqual([]);
    await expect(stranger.mutation(api.production_recipes.archive, { instanceId: OTHER_INSTANCE_ID, recipeId })).rejects.toThrow("not found");
  });
});
