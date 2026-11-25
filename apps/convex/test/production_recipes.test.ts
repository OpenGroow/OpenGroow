import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("deletes a recipe with its versions", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    await owner.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content });
    await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
    expect(await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID, familyId })).toEqual([]);
    expect(await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("productionRecipeVersions").collect())).toEqual([]);
  });

  it("refuses edits on a recipe archived before archiving was removed", async () => {
    const { t, owner, recipeId } = await setup();
    await t.run((ctx) => ctx.db.patch(recipeId, { status: "archived" }));
    await expect(owner.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content })).rejects.toThrow("archived");
  });

  it("keeps the proposal that created a deleted recipe marked as created, so it cannot create another", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    const runId = await t.run((ctx) =>
      ctx.db.insert("runs", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@example/video", agentName: "strategy", sessionKey: "s", status: "completed",
        createdAt: 1, updatedAt: 1, recipeGeneration: { familyId, tryCount: 1 }, recipeProposal: { proposal: {} }, recipeId,
      } as never),
    );
    await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
    expect(((await t.run((ctx) => ctx.db.get(runId))) as { recipeId?: unknown }).recipeId).toBe(recipeId);
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "Again", description: "d", ...TARGET, ...content, proposalRunId: runId })).rejects.toThrow(/already/i);
  });

  it("refuses to delete a recipe a proposed or approved planned content uses", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@example/strategy", agentName: "strategy", sessionKey: "p", status: "completed", createdAt: 1, updatedAt: 1, recipeGeneration: { familyId, tryCount: 1 } } as never);
      const planId = await ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, runId, periodStart: "2026-12-01", periodEnd: "2026-12-07", rationale: "r", status: "approved", createdAt: 1 });
      await ctx.db.insert("plannedContents", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, planId, kind: "video", missionType: "create_letter_video", recipeId, publishTargets: [], title: "t", brief: "b", plannedAt: "2026-12-01", intent: "explore", rationale: "r", status: "approved", createdAt: 1 } as never);
    });
    await expect(owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId })).rejects.toThrow(/planned content/);
    expect(await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId })).not.toBeNull();
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
    await expect(stranger.mutation(api.production_recipes.remove, { instanceId: OTHER_INSTANCE_ID, recipeId })).rejects.toThrow("not found");
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

  it("changes the target, validated, and refuses it on an archived recipe", async () => {
    const { t, owner, recipeId } = await setup();
    const args = { instanceId: INSTANCE_ID, recipeId };
    await owner.mutation(api.production_recipes.setTarget, { ...args, templateId: "@example/video-b", missionType: "create_letter_video" });
    expect(await owner.query(api.production_recipes.get, args)).toMatchObject({ templateId: "@example/video-b" });
    await expect(owner.mutation(api.production_recipes.setTarget, { ...args, templateId: "@example/no-provider", missionType: "create_letter_video" })).rejects.toThrow("provider");
    expect(await owner.query(api.production_recipes.get, args)).toMatchObject({ templateId: "@example/video-b" });
    await t.run((ctx) => ctx.db.patch(recipeId, { status: "archived" }));
    await expect(owner.mutation(api.production_recipes.setTarget, { ...args, ...TARGET })).rejects.toThrow("archived");
  });

  it("offers only the active recipes of that Template and Mission type, to the owner", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    const base = { instanceId: INSTANCE_ID, familyId, description: "", ...content };
    const archived = await owner.mutation(api.production_recipes.create, { ...base, name: "Old", ...TARGET });
    await t.run((ctx) => ctx.db.patch(archived.recipeId, { status: "archived" }));
    await owner.mutation(api.production_recipes.create, { ...base, name: "Other Template", templateId: "@example/video-b", missionType: "create_letter_video" });
    const offered = await owner.query(api.production_recipes.listForMissionType, { instanceId: INSTANCE_ID, ...TARGET });
    expect(offered).toEqual([{ _id: recipeId, name: "Recipe A", description: "d", latestVersion: 1 }]);
    expect(await owner.query(api.production_recipes.listForMissionType, { instanceId: INSTANCE_ID, templateId: TARGET.templateId, missionType: "create_letter_only_video" })).toEqual([]);
    expect(await t.withIdentity(STRANGER).query(api.production_recipes.listForMissionType, { instanceId: INSTANCE_ID, ...TARGET })).toEqual([]);
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

// Family performance (ADR-084, #156) attributes a Publication to the family of its recipe on read. That is
// only correct while a Production Recipe never changes Creative Family.
describe("a Production Recipe never changes Creative Family", () => {
  it("keeps its family through every recipe operation", async () => {
    const { t, owner, familyId, recipeId } = await setup();
    const args = { instanceId: INSTANCE_ID, recipeId };
    await owner.mutation(api.production_recipes.saveVersion, { ...args, ...content });
    await owner.mutation(api.production_recipes.setTarget, { ...args, templateId: "@example/video-b", missionType: "create_letter_video" });
    const row = await t.run((ctx) => ctx.db.get(recipeId));
    expect(row!.creativeFamilyId).toBe(familyId);
  });

  it("is written only when the recipe is inserted: no code patches or replaces creativeFamilyId", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /ctx\.db\.(patch|replace)\([^)]*\{[^}]*creativeFamilyId/s.test(readFileSync(join(dir, f), "utf8")) && !/creative_family_(merge|sources)/.test(f));
    expect(offenders).toEqual([]);
  });
});

describe("production_recipes.create from a Recipe Proposal (ADR-087)", () => {
  const proposal = { proposal: { recipe: { name: "Generated" }, sourceIds: [], rationale: "r" } };

  async function withProposal(extra: { instanceId?: string; familyId?: unknown; proposal?: unknown } = {}) {
    const t = convexTest(schema, modules);
    await seed(t);
    const familyId = await family(t);
    const otherFamilyId = await family(t);
    const owner = t.withIdentity(OWNER);
    const insertRun = (fields: Record<string, unknown>) =>
      t.run((ctx) => {
        const now = Date.now();
        return ctx.db.insert("runs", {
          ownerId: OWNER.subject,
          instanceId: INSTANCE_ID,
          templateId: "@example/strategist",
          agentName: "a",
          sessionKey: "s",
          status: "completed",
          createdAt: now,
          updatedAt: now,
          recipeGeneration: { familyId, tryCount: 1 },
          recipeProposal: proposal,
          ...fields,
        } as never);
      });
    const runId = await insertRun({});
    const args = (proposalRunId: unknown = runId): Record<string, unknown> =>
      ({ instanceId: INSTANCE_ID, familyId, name: "Edited name", description: "d", ...TARGET, ...content, proposalRunId });
    return { t, owner, familyId, otherFamilyId, runId, insertRun, args };
  }

  it("creates one active Recipe at version 1 and marks the Run", async () => {
    const { t, owner, runId, args } = await withProposal();
    const created = await owner.mutation(api.production_recipes.create, args() as never);
    expect(created.version).toBe(1);
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run && "recipeId" in run ? run.recipeId : undefined).toBe(created.recipeId);
    const recipe = await t.run((ctx) => ctx.db.get(created.recipeId));
    expect(recipe?.status).toBe("active");
  });

  it("refuses a second creation from the same proposal and creates nothing", async () => {
    const { t, owner, args } = await withProposal();
    await owner.mutation(api.production_recipes.create, args() as never);
    await expect(owner.mutation(api.production_recipes.create, args() as never)).rejects.toThrow(/already/);
    expect(await t.run((ctx) => ctx.db.query("productionRecipes").collect())).toHaveLength(1);
  });

  it("refuses a proposal Run of another Project", async () => {
    const { t, owner, insertRun, args } = await withProposal();
    const other = await insertRun({ instanceId: OTHER_INSTANCE_ID });
    await expect(owner.mutation(api.production_recipes.create, args(other) as never)).rejects.toThrow(/proposal/i);
    expect(await t.run((ctx) => ctx.db.query("productionRecipes").collect())).toHaveLength(0);
  });

  it("refuses a proposal Run of another family", async () => {
    const { t, owner, otherFamilyId, insertRun, args } = await withProposal();
    const other = await insertRun({ recipeGeneration: { familyId: otherFamilyId, tryCount: 1 } });
    await expect(owner.mutation(api.production_recipes.create, args(other) as never)).rejects.toThrow(/proposal/i);
    expect(await t.run((ctx) => ctx.db.query("productionRecipes").collect())).toHaveLength(0);
  });

  it("refuses a Run that holds no proposal", async () => {
    const { owner, insertRun, args } = await withProposal();
    const none = await insertRun({ recipeProposal: { no_opportunity: { reason: "x" } } });
    const unset = await insertRun({ recipeProposal: undefined });
    await expect(owner.mutation(api.production_recipes.create, args(none) as never)).rejects.toThrow(/proposal/i);
    await expect(owner.mutation(api.production_recipes.create, args(unset) as never)).rejects.toThrow(/proposal/i);
  });

  it("re-validates a changed Template and creates nothing on error", async () => {
    const { t, owner, runId, args } = await withProposal();
    const bad = { ...args(runId), templateId: "@example/no-provider" };
    await expect(owner.mutation(api.production_recipes.create, bad as never)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("productionRecipes").collect())).toHaveLength(0);
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run && "recipeId" in run ? run.recipeId : undefined).toBeUndefined();
  });

  it("still creates manually without a proposal", async () => {
    const { owner, familyId } = await withProposal();
    const created = await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, familyId, name: "M", description: "d", ...TARGET, ...content });
    expect(created.version).toBe(1);
  });
});
