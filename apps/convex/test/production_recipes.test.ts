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

const content = {
  prompt: "A calm reaction.",
  instructions: "Keep it calm.",
  constraints: ["No dialogue", "  "],
};

async function setup() {
  const t = convexTest(schema, modules);
  await seed(t);
  const owner = t.withIdentity(OWNER);
  const created = await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "Recipe A", description: "d", ...TARGET, ...content });
  return { t, owner, ...created };
}

describe("production_recipes", () => {
  it("creates a recipe with version 1 and cleans blank constraints", async () => {
    const { owner, recipeId, version } = await setup();
    expect(version).toBe(1);
    const got = await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId });
    expect(got).toMatchObject({ name: "Recipe A", latest: { version: 1, constraints: ["No dialogue"] } });
    expect(got).not.toHaveProperty("status");
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
    const { t, owner, recipeId } = await setup();
    await owner.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content });
    await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
    expect(await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID })).toEqual([]);
    expect(await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("productionRecipeVersions").collect())).toEqual([]);
  });

  it("edits, offers and deletes a recipe archived before archiving was removed, like any other", async () => {
    const { t, owner, recipeId } = await setup();
    await t.run((ctx) => ctx.db.patch(recipeId, { status: "archived" }));
    expect(await owner.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content })).toBe(2);
    await owner.mutation(api.production_recipes.setTarget, { instanceId: INSTANCE_ID, recipeId, ...TARGET });
    expect((await owner.query(api.production_recipes.listForMissionType, { instanceId: INSTANCE_ID, ...TARGET })).map((r) => r._id)).toEqual([recipeId]);
    await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
    expect(await owner.query(api.production_recipes.get, { instanceId: INSTANCE_ID, recipeId })).toBeNull();
  });

  it("keeps the proposal that created a deleted recipe marked as created, so it cannot create another", async () => {
    const { t, owner, recipeId } = await setup();
    const runId = await t.run((ctx) =>
      ctx.db.insert("runs", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@example/video", agentName: "strategy", sessionKey: "s", status: "completed",
        createdAt: 1, updatedAt: 1, recipeGeneration: { sourceIds: [], tryCount: 1 }, recipeProposal: { proposal: {} }, recipeId,
      } as never),
    );
    await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
    expect(((await t.run((ctx) => ctx.db.get(runId))) as { recipeId?: unknown }).recipeId).toBe(recipeId);
    await expect(owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "Again", description: "d", ...TARGET, ...content, proposalRunId: runId })).rejects.toThrow(/already/i);
  });

  describe("deletion with Planned Contents", () => {
    const DAY = 86_400_000;
    const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

    async function withPlans() {
      const ctx = await setup();
      const { t, recipeId } = ctx;
      const ids = await t.run(async (db) => {
        const runId = await db.db.insert("runs", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@example/strategy", agentName: "strategy", sessionKey: "p", status: "completed", createdAt: 1, updatedAt: 1, recipeGeneration: { sourceIds: [], tryCount: 1 } } as never);
        const plan = (status: "draft" | "approved") => db.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, runId, periodStart: day(-10), periodEnd: day(10), rationale: "r", status, createdAt: 1 });
        const draft = await plan("draft");
        const approved = await plan("approved");
        const content = (planId: typeof draft, status: "proposed" | "approved" | "rejected", plannedAt: string, title: string) =>
          db.db.insert("plannedContents", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, planId, kind: "video", missionType: "create_letter_video", recipeId, publishTargets: [], title, brief: "b", plannedAt, intent: "explore", rationale: "r", status, createdAt: 1 });
        const missionId = await db.db.insert("missions", {
          ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: TARGET.templateId, type: TARGET.missionType, payload: {}, status: "doing", createdAt: 1, updatedAt: 1,
          recipeSnapshot: { recipeId, recipeName: "Recipe A", version: 1, instructions: "Keep it calm.", constraints: ["No dialogue"] },
        } as never);
        return {
          proposed: await content(draft, "proposed", day(3), "Proposed"),
          removedProposal: await content(draft, "rejected", day(3), "Removed proposal"),
          upcoming: await content(approved, "approved", day(0), "Upcoming"),
          past: await content(approved, "approved", day(-1), "Past"),
          missionId,
        };
      });
      return { ...ctx, ids };
    }

    it("counts the Planned Contents not produced yet that go with the recipe", async () => {
      const { owner, recipeId } = await withPlans();
      expect(await owner.query(api.production_recipes.deletionImpact, { instanceId: INSTANCE_ID, recipeId })).toEqual({ plannedContents: 2 });
      expect(await owner.query(api.production_recipes.deletionImpact, { instanceId: OTHER_INSTANCE_ID, recipeId })).toBeNull();
    });

    it("deletes the recipe with its proposals and upcoming approved contents, and keeps history and Missions", async () => {
      const { t, owner, recipeId, ids } = await withPlans();
      await owner.mutation(api.production_recipes.remove, { instanceId: INSTANCE_ID, recipeId });
      await t.run(async (ctx) => {
        expect(await ctx.db.get(recipeId)).toBeNull();
        expect(await ctx.db.get(ids.proposed)).toBeNull();
        expect(await ctx.db.get(ids.upcoming)).toBeNull();
        expect(await ctx.db.get(ids.past)).not.toBeNull();
        expect(await ctx.db.get(ids.removedProposal)).not.toBeNull();
        expect(await ctx.db.get(ids.missionId)).toMatchObject({ status: "doing", recipeSnapshot: { recipeId, version: 1, instructions: "Keep it calm." } });
      });
    });

    it("deletes nothing when the recipe belongs to another Project", async () => {
      const { t, recipeId, ids } = await withPlans();
      await expect(t.withIdentity(STRANGER).mutation(api.production_recipes.remove, { instanceId: OTHER_INSTANCE_ID, recipeId })).rejects.toThrow("not found");
      expect(await t.run((ctx) => ctx.db.get(ids.proposed))).not.toBeNull();
    });
  });

  it("creates a recipe that belongs to no Creative Family and keeps no inspiration", async () => {
    const { t, recipeId } = await setup();
    const row = (await t.run((ctx) => ctx.db.get(recipeId)))!;
    expect(Object.keys(row).filter((key) => !key.startsWith("_")).sort()).toEqual(["description", "instanceId", "missionType", "name", "templateId"]);
  });

  it("lists every recipe of the Project, whichever way it was created", async () => {
    const { owner } = await setup();
    await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "B", description: "", ...TARGET, ...content });
    const listed = await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID });
    expect(listed.map((recipe) => recipe.name).sort()).toEqual(["B", "Recipe A"]);
    expect(listed[0]).toMatchObject({ latestVersion: 1 });
    expect(listed[0]).not.toHaveProperty("creativeFamilyId");
  });

  it("isolates recipes per Project", async () => {
    const { t, recipeId } = await setup();
    const stranger = t.withIdentity(STRANGER);
    // Stranger cannot act on the owner's Instance.
    await expect(stranger.mutation(api.production_recipes.saveVersion, { instanceId: INSTANCE_ID, recipeId, ...content })).rejects.toThrow();
    expect(await stranger.query(api.production_recipes.list, { instanceId: INSTANCE_ID })).toEqual([]);
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
    const { owner } = await setup();
    const base = { instanceId: INSTANCE_ID, name: "B", description: "", ...content };
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/no-provider", missionType: "create_letter_video" })).rejects.toThrow("provider");
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/video-a", missionType: "nope" })).rejects.toThrow("does not exist");
    await expect(owner.mutation(api.production_recipes.create, { ...base, templateId: "@example/missing", missionType: "create_letter_video" })).rejects.toThrow("not installed");
  });

  it("allows several recipes for the same Mission type, and a same-named type on another Template", async () => {
    const { owner } = await setup();
    const base = { instanceId: INSTANCE_ID, description: "", ...content };
    await owner.mutation(api.production_recipes.create, { ...base, name: "B", ...TARGET });
    await owner.mutation(api.production_recipes.create, { ...base, name: "C", templateId: "@example/video-b", missionType: "create_letter_video" });
    expect(await owner.query(api.production_recipes.list, { instanceId: INSTANCE_ID })).toHaveLength(3);
  });

  it("changes the target, validated", async () => {
    const { owner, recipeId } = await setup();
    const args = { instanceId: INSTANCE_ID, recipeId };
    await owner.mutation(api.production_recipes.setTarget, { ...args, templateId: "@example/video-b", missionType: "create_letter_video" });
    expect(await owner.query(api.production_recipes.get, args)).toMatchObject({ templateId: "@example/video-b" });
    await expect(owner.mutation(api.production_recipes.setTarget, { ...args, templateId: "@example/no-provider", missionType: "create_letter_video" })).rejects.toThrow("provider");
    expect(await owner.query(api.production_recipes.get, args)).toMatchObject({ templateId: "@example/video-b" });
  });

  it("offers the recipes of that Template and Mission type, to the owner", async () => {
    const { t, owner, recipeId } = await setup();
    const base = { instanceId: INSTANCE_ID, description: "", ...content };
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
      const { owner } = await setupStaged();
      const targets = await owner.query(api.production_recipes.listTargets, { instanceId: INSTANCE_ID });
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({ templateId: "@example/video-staged", missionType: "create_letter_video" });
      await expect(
        owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "S", description: "", ...content, templateId: "@example/video-staged", missionType: "create_letter_video" }),
      ).resolves.toBeTruthy();
    });

    it("still refuses when no installed version declares the provider", async () => {
      const { owner } = await setupStaged();
      setTemplateRegistryForTests(inMemoryRegistry([INSTANCE_ID], [template("@example/video-staged", [missionType({ contextProviders: [] })])]));
      await expect(
        owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "S", description: "", ...content, templateId: "@example/video-staged", missionType: "create_letter_video" }),
      ).rejects.toThrow("provider");
    });
  });
});

describe("production_recipes.create from a Recipe Proposal (ADR-087)", () => {
  const proposal = { proposal: { recipe: { name: "Generated" }, sourceIds: [], rationale: "r" } };

  async function withProposal() {
    const t = convexTest(schema, modules);
    await seed(t);
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
          recipeGeneration: { sourceIds: [], tryCount: 1 },
          recipeProposal: proposal,
          ...fields,
        } as never);
      });
    const runId = await insertRun({});
    const args = (proposalRunId: unknown = runId): Record<string, unknown> =>
      ({ instanceId: INSTANCE_ID, name: "Edited name", description: "d", ...TARGET, ...content, proposalRunId });
    return { t, owner, runId, insertRun, args };
  }

  it("creates one Recipe at version 1 and marks the Run", async () => {
    const { t, owner, runId, args } = await withProposal();
    const created = await owner.mutation(api.production_recipes.create, args() as never);
    expect(created.version).toBe(1);
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run && "recipeId" in run ? run.recipeId : undefined).toBe(created.recipeId);
    expect(await t.run((ctx) => ctx.db.get(created.recipeId))).not.toBeNull();
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
    const { owner } = await withProposal();
    const created = await owner.mutation(api.production_recipes.create, { instanceId: INSTANCE_ID, name: "M", description: "d", ...TARGET, ...content });
    expect(created.version).toBe(1);
  });
});
