import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

// ADR-088: Production Recipes and Recipe Generation Runs stop referencing a Creative Family.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

const INSTANCE = "instance-mig";
const OWNER = "owner-mig";
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

async function migrate(t: ReturnType<typeof convexTest>, migration: Parameters<typeof runToCompletion>[2]) {
  await t.run(async (ctx) => {
    await runToCompletion(ctx, components.migrations, migration);
  });
}

const base = { ownerId: OWNER, instanceId: INSTANCE, templateId: "strategist", agentName: "strategist", sessionKey: "s", createdAt: NOW, updatedAt: NOW };

describe("migrations.dropRecipeFamily", () => {
  it("removes the Creative Family from a recipe and leaves the rest of it and its versions as they are", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const { recipeId } = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-1", name: "Example family", description: "A mechanic" });
      const recipeId = await ctx.db.insert("productionRecipes", {
        instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "example/post", missionType: "make_post", name: "Example recipe", description: "d", status: "active",
      });
      await ctx.db.insert("productionRecipeVersions", { instanceId: INSTANCE, recipeId, version: 1, instructions: "i", constraints: ["c"], createdAt: NOW });
      return { recipeId };
    });

    await migrate(t, internal.migrations.dropRecipeFamily);
    await migrate(t, internal.migrations.dropRecipeFamily);

    await t.run(async (ctx) => {
      const recipe = (await ctx.db.get(recipeId))!;
      expect(recipe.creativeFamilyId).toBeUndefined();
      expect(recipe).toMatchObject({ name: "Example recipe", templateId: "example/post", missionType: "make_post", status: "active" });
      const versions = await ctx.db.query("productionRecipeVersions").withIndex("by_recipe_version", (q) => q.eq("recipeId", recipeId)).collect();
      expect(versions).toHaveLength(1);
    });
  });
});

describe("migrations.stripRecipeGenerationFamily", () => {
  const addSource = (ctx: { db: any }, familyId: Id<"creativeFamilies">, capturedAt: number, o: { status?: string; excluded?: boolean } = {}) =>
    ctx.db.insert("sources", {
      instanceId: INSTANCE, ownerId: OWNER, templateId: "example/source", sourceId: "post", label: "Example source", family: "fam", status: o.status ?? "ready",
      marketing: { summary: "about" }, analysis: {}, origin: "https://example.com/p", capturedAt, createdAt: capturedAt, creativeFamilyId: familyId, ...(o.excluded ? { excluded: true } : {}),
    }) as Promise<Id<"sources">>;

  it("keeps a Run in flight readable by pinning its family's readable Sources, newest first, and keeps its retry state", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const ids = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-1", name: "Example family", description: "A mechanic" });
      const old = await addSource(ctx, familyId, NOW - 3000);
      const recent = await addSource(ctx, familyId, NOW - 1000);
      await addSource(ctx, familyId, NOW - 2000, { excluded: true });
      await addSource(ctx, familyId, NOW - 500, { status: "processing" });
      const first = await ctx.db.insert("runs", { ...base, status: "failed", recipeGeneration: { familyId, tryCount: 1 } } as never);
      const retry = await ctx.db.insert("runs", {
        ...base, status: "running", resumedFromRunId: first,
        recipeGeneration: { familyId, instructions: "Keep it short", tryCount: 2, generationId: first, feedback: "name: must not be empty" },
      } as never);
      return { old, recent, first, retry };
    });

    await migrate(t, internal.migrations.stripRecipeGenerationFamily);

    await t.run(async (ctx) => {
      const retry = (await ctx.db.get(ids.retry)) as { recipeGeneration: Record<string, unknown> };
      expect(retry.recipeGeneration).toEqual({ sourceIds: [ids.recent, ids.old], instructions: "Keep it short", tryCount: 2, generationId: ids.first, feedback: "name: must not be empty" });
      const first = (await ctx.db.get(ids.first)) as { recipeGeneration: Record<string, unknown> };
      expect(first.recipeGeneration).toEqual({ sourceIds: [], tryCount: 1 });
    });
  });

  it("keeps the historical result of a settled generation, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const { runId, recipeId } = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-1", name: "Example family", description: "A mechanic" });
      await addSource(ctx, familyId, NOW);
      const recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, templateId: "example/post", missionType: "make_post", name: "Example recipe", description: "d", status: "active" });
      const runId = await ctx.db.insert("runs", {
        ...base, status: "completed", recipeGeneration: { familyId, tryCount: 1 }, recipeProposal: { proposal: { name: "Example recipe" } }, recipeId,
      } as never);
      return { runId, recipeId };
    });

    await migrate(t, internal.migrations.stripRecipeGenerationFamily);
    await migrate(t, internal.migrations.stripRecipeGenerationFamily);

    await t.run(async (ctx) => {
      const run = (await ctx.db.get(runId)) as Record<string, unknown>;
      expect(run.recipeGeneration).toEqual({ sourceIds: [], tryCount: 1 });
      expect(run.recipeProposal).toEqual({ proposal: { name: "Example recipe" } });
      expect(run.recipeId).toBe(recipeId);
    });
  });

  it("pins at most 25 Sources", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const runId = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "article-1", name: "Example family", description: "A mechanic" });
      for (let i = 0; i < 30; i++) await addSource(ctx, familyId, NOW - i);
      return await ctx.db.insert("runs", { ...base, status: "pending", recipeGeneration: { familyId, tryCount: 1 } } as never);
    });
    await migrate(t, internal.migrations.stripRecipeGenerationFamily);
    await t.run(async (ctx) => {
      const run = (await ctx.db.get(runId)) as { recipeGeneration: { sourceIds: unknown[] } };
      expect(run.recipeGeneration.sourceIds).toHaveLength(25);
    });
  });
});
