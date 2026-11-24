import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// Issue #167: the dashboard reads of the Strategic Memory (current + history).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../strategic_memory.ts": () => import("../strategic_memory.js"),
};

const INSTANCE_ID = "instance-sm";
const OTHER_INSTANCE_ID = "instance-sm-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-sm", subject: "owner-sm" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-sm", subject: "stranger-sm" };
const FIRST_PAGE = { numItems: 50, cursor: null };

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;

beforeEach(async () => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], [loadFixtureTemplate("sources-fixture")]);
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-sm", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-sm-2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
});
afterEach(() => restoreRegistry());

const owner = () => t.withIdentity(OWNER);
const stranger = () => t.withIdentity(STRANGER);

type Refs = { familyIds?: Id<"creativeFamilies">[]; recipeIds?: Id<"productionRecipes">[]; publicationIds?: Id<"publications">[] };

async function review(instanceId: string, fields: { createdAt: number; memory?: string; memoryChanged?: boolean; refs?: Refs }) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId, templateId: "tpl", agentName: "strategy", sessionKey: `s-${Math.random()}`,
      status: "running", createdAt: now, updatedAt: now,
    });
    return await ctx.db.insert("strategicReviews", {
      ownerId: OWNER.subject, instanceId, runId, periodStart: 1_000, periodEnd: 2_000,
      report: `Report ${fields.createdAt}`, consolidatedMemory: fields.memory ?? `Memory ${fields.createdAt}`,
      references: { familyIds: [], recipeIds: [], publicationIds: [], ...fields.refs },
      memoryChanged: fields.memoryChanged ?? true, createdAt: fields.createdAt,
    });
  });
}

describe("strategic_memory.current", () => {
  it("is null before any review", async () => {
    expect(await owner().query(api.strategic_memory.current, { instanceId: INSTANCE_ID })).toBeNull();
  });

  it("returns the latest review's memory, period and date", async () => {
    await review(INSTANCE_ID, { createdAt: 10 });
    await review(INSTANCE_ID, { createdAt: 20, memory: "Latest memory" });
    const current = await owner().query(api.strategic_memory.current, { instanceId: INSTANCE_ID });
    expect(current).toMatchObject({ consolidatedMemory: "Latest memory", periodStart: 1_000, periodEnd: 2_000, createdAt: 20 });
  });

  it("never serves another Project's reviews or a stranger", async () => {
    await review(OTHER_INSTANCE_ID, { createdAt: 10 });
    expect(await owner().query(api.strategic_memory.current, { instanceId: INSTANCE_ID })).toBeNull();
    await review(INSTANCE_ID, { createdAt: 20 });
    expect(await stranger().query(api.strategic_memory.current, { instanceId: INSTANCE_ID })).toBeNull();
  });
});

describe("strategic_memory.history", () => {
  it("lists reviews newest first with report, memory and memoryChanged", async () => {
    await review(INSTANCE_ID, { createdAt: 10 });
    await review(INSTANCE_ID, { createdAt: 30, memoryChanged: false });
    await review(INSTANCE_ID, { createdAt: 20 });
    await review(OTHER_INSTANCE_ID, { createdAt: 40 });
    const result = await owner().query(api.strategic_memory.history, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page.map((r) => r.createdAt)).toEqual([30, 20, 10]);
    expect(result.page[0]).toMatchObject({ report: "Report 30", consolidatedMemory: "Memory 30", memoryChanged: false });
  });

  it("paginates", async () => {
    for (const createdAt of [1, 2, 3]) await review(INSTANCE_ID, { createdAt });
    const first = await owner().query(api.strategic_memory.history, { instanceId: INSTANCE_ID, paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page.map((r) => r.createdAt)).toEqual([3, 2]);
    expect(first.isDone).toBe(false);
    const second = await owner().query(api.strategic_memory.history, { instanceId: INSTANCE_ID, paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    expect(second.page.map((r) => r.createdAt)).toEqual([1]);
  });

  it("is empty for a stranger", async () => {
    await review(INSTANCE_ID, { createdAt: 10 });
    const result = await stranger().query(api.strategic_memory.history, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(result.page).toEqual([]);
  });
});

describe("strategic_memory.references", () => {
  it("resolves families, recipes and publications, archived ones included, and flags deleted ones", async () => {
    const { families, recipe, publication, gone } = await t.run(async (ctx) => {
      const now = Date.now();
      const active = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "a", name: "Active family", description: "d" });
      const archived = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "b", name: "Old family", description: "d", status: "archived" });
      const gone = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "c", name: "Deleted", description: "d" });
      await ctx.db.delete(gone);
      const recipe = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE_ID, creativeFamilyId: active, templateId: "tpl", missionType: "make_reel", name: "Recipe", description: "d", status: "archived" } as never);
      const missionId = await ctx.db.insert("missions", { ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "tpl", type: "make_reel", payload: {}, status: "done", createdAt: now, updatedAt: now });
      const publication = await ctx.db.insert("publications", { missionId, instanceId: INSTANCE_ID, target: "instagram:me", status: "published", createdAt: now, updatedAt: now });
      return { families: [active, archived], recipe, publication, gone };
    });
    const id = await review(INSTANCE_ID, { createdAt: 10, refs: { familyIds: [...families, gone], recipeIds: [recipe], publicationIds: [publication] } });
    const refs = await owner().query(api.strategic_memory.references, { instanceId: INSTANCE_ID, reviewId: id });
    expect(refs?.families).toEqual([
      expect.objectContaining({ id: families[0], name: "Active family", archived: false }),
      expect.objectContaining({ id: families[1], name: "Old family", archived: true }),
      expect.objectContaining({ id: gone, name: null }),
    ]);
    expect(refs?.recipes).toEqual([expect.objectContaining({ id: recipe, name: "Recipe", archived: true, familyId: families[0] })]);
    expect(refs?.publications).toEqual([expect.objectContaining({ id: publication, target: "instagram:me" })]);
  });

  it("never resolves an entity of another Project referenced by a review", async () => {
    const foreign = await t.run(async (ctx) => {
      const now = Date.now();
      const family = await ctx.db.insert("creativeFamilies", { instanceId: OTHER_INSTANCE_ID, slug: "x", name: "Foreign family", description: "d" });
      const recipe = await ctx.db.insert("productionRecipes", { instanceId: OTHER_INSTANCE_ID, creativeFamilyId: family, templateId: "tpl", missionType: "make_reel", name: "Foreign recipe", description: "d", status: "active" } as never);
      const missionId = await ctx.db.insert("missions", { ownerId: STRANGER.subject, instanceId: OTHER_INSTANCE_ID, templateId: "tpl", type: "make_reel", payload: {}, status: "done", createdAt: now, updatedAt: now });
      const publication = await ctx.db.insert("publications", { missionId, instanceId: OTHER_INSTANCE_ID, target: "instagram:other", status: "published", createdAt: now, updatedAt: now });
      return { family, recipe, publication };
    });
    const id = await review(INSTANCE_ID, { createdAt: 10, refs: { familyIds: [foreign.family], recipeIds: [foreign.recipe], publicationIds: [foreign.publication] } });
    const refs = await owner().query(api.strategic_memory.references, { instanceId: INSTANCE_ID, reviewId: id });
    expect(refs?.families).toEqual([{ id: foreign.family, name: null, archived: false }]);
    expect(refs?.recipes).toEqual([{ id: foreign.recipe, name: null, archived: false, familyId: null }]);
    expect(refs?.publications).toEqual([{ id: foreign.publication, target: null, missionId: null }]);
  });

  it("is null for another Project's review or a stranger", async () => {
    const other = await review(OTHER_INSTANCE_ID, { createdAt: 10 });
    expect(await owner().query(api.strategic_memory.references, { instanceId: INSTANCE_ID, reviewId: other })).toBeNull();
    const mine = await review(INSTANCE_ID, { createdAt: 20 });
    expect(await stranger().query(api.strategic_memory.references, { instanceId: INSTANCE_ID, reviewId: mine })).toBeNull();
  });
});
