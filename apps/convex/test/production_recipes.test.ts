import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, inMemoryRegistry, installTemplateRegistry } from "./helpers/template_registry.helpers";
import { setTemplateRegistryForTests } from "../template_registry";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
};

const INSTANCE_ID = "instance-rec";
const OTHER_INSTANCE_ID = "instance-rec-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-rec", subject: "owner-rec" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-rec", subject: "stranger-rec" };

const missionType = (extra: Record<string, unknown> = {}) => ({
  type: "create_letter_video",
  label: "Letter video",
  contextProviders: ["production-recipe"],
  fields: [],
  ...extra,
});
const template = (id: string, types: unknown[] = [missionType()]) => fixtureTemplate(id, { missionTypes: types } as never);
const TARGET = { templateId: "@example/video-a", missionType: "create_letter_video" };

beforeEach(() => {
  restoreRegistry = installTemplateRegistry(
    [INSTANCE_ID, OTHER_INSTANCE_ID],
    [template("@example/video-a"), template("@example/video-b"), template("@example/no-provider", [missionType({ contextProviders: [] })])],
  );
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
  prompt: "A calm reaction.",
  instructions: "Keep it calm.",
  constraints: ["No dialogue", "  "],
};

async function setup() {
  const t = convexTest(schema, modules);
  await seed(t);
  const familyId = await family(t);
  const owner = t.withIdentity(OWNER);
  const created = await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "Recipe A", description: "d", ...TARGET, ...content });
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
      instanceId: INSTANCE_ID, recipeId, ...content, prompt: "Another take.",
    });
    expect(v2).toBe(2);
    const versions = await owner.query(api.production_recipes.listVersions, { instanceId: INSTANCE_ID, recipeId });
    expect(versions.map((x) => x.version)).toEqual([2, 1]);
    expect(versions[1]!.prompt).toBe("A calm reaction.");
    expect(versions[0]!.prompt).toBe("Another take.");
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
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId: archived, name: "X", description: "", ...TARGET, ...content })).rejects.toThrow("archived");
    const foreign = await family(t, OTHER_INSTANCE_ID);
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId: foreign, name: "X", description: "", ...TARGET, ...content })).rejects.toThrow("not found");
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

  it("keeps the target on the recipe and returns it", async () => {
    const { owner, recipeId } = await setup();
    expect(await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId })).toMatchObject(TARGET);
  });

  it("refuses a Mission type without the provider, an unknown one and a Template that is not installed", async () => {
    const { owner, familyId } = await setup();
    const base = { instanceId: INSTANCE_ID, familyId, name: "B", description: "", ...content };
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/no-provider", missionType: "create_letter_video" })).rejects.toThrow("provider");
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/video-a", missionType: "nope" })).rejects.toThrow("does not exist");
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/missing", missionType: "create_letter_video" })).rejects.toThrow("not installed");
  });

  it("allows several recipes for the same Mission type, and a same-named type on another Template", async () => {
    const { owner, familyId } = await setup();
    const base = { instanceId: INSTANCE_ID, familyId, description: "", ...content };
    await owner.mutation(api.production_recipes.create, { ...base, name: "B", ...TARGET });
    await owner.mutation(api.production_recipes.create, { ...base, name: "C", templateId: "@example/video-b", missionType: "create_letter_video" });
    expect(await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID, familyId })).toHaveLength(3);
  });

  it("lists targets that declare the provider", async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      for (const templateId of ["@example/video-a", "@example/no-provider"]) {
        await ctx.db.insert("installedTemplates", { projectId: INSTANCE_ID, templateId, version: "1.0.0", origin: "hub", digest: "d", manifest: {}, current: true, installedAt: 1 } as never);
      }
    });
    const targets = await owner.query(api.production_recipes.listTargets, { instanceId: INSTANCE_ID });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ templateId: "@example/video-a", missionType: "create_letter_video", label: "Letter video" });
  });

  describe("staged Template version", () => {
    async function setupStaged() {
      const ctx = await setup();
      // v1 (current) declares no provider; v2 (staged, not applied) does.
      const v1 = template("@example/video-staged", [missionType({ contextProviders: [] })]);
      const v2 = template("@example/video-staged", [missionType()]);
      setTemplateRegistryForTests({
        async resolve(_p, id, version) {
          if (id !== "@example/video-staged") return undefined;
          return version === "2.0.0" ? v2 : version === undefined || version === "1.0.0" ? v1 : undefined;
        },
        async list() {
          return [];
        },
      });
      await ctx.t.run(async (db) => {
        await db.db.insert("installedTemplates", { projectId: INSTANCE_ID, templateId: "@example/video-staged", version: "1.0.0", origin: "hub", digest: "d", manifest: {}, current: true, installedAt: 1 } as never);
        await db.db.insert("installedTemplates", { projectId: INSTANCE_ID, templateId: "@example/video-staged", version: "2.0.0", origin: "hub", digest: "d", manifest: {}, current: false, staged: true, installedAt: 2 } as never);
      });
      return ctx;
    }

    it("offers a target only the staged version declares, and accepts a recipe for it", async () => {
      const { owner, familyId } = await setupStaged();
      const targets = await owner.query(api.production_recipes.listTargets, { instanceId: INSTANCE_ID });
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({ templateId: "@example/video-staged", missionType: "create_letter_video" });
      await expect(
        owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "S", description: "", ...content, templateId: "@example/video-staged", missionType: "create_letter_video" }),
      ).resolves.toBeTruthy();
    });

    it("still refuses when no installed version declares the provider", async () => {
      const { owner, familyId } = await setupStaged();
      setTemplateRegistryForTests(inMemoryRegistry([INSTANCE_ID], [template("@example/video-staged", [missionType({ contextProviders: [] })])]));
      await expect(
        owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "S", description: "", ...content, templateId: "@example/video-staged", missionType: "create_letter_video" }),
      ).rejects.toThrow("provider");
    });
  });
});
