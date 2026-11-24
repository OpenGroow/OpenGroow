import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { STRATEGIC_REVIEW_LIMITS } from "../strategic_review_rules";

// Issue #164: persisting a Strategic Review (immutable, atomic, idempotent).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../strategic_reviews.ts": () => import("../strategic_reviews.js"),
};

const INSTANCE_ID = "instance-sr";
const OTHER_INSTANCE_ID = "instance-sr-other";
const OWNER_ID = "owner-sr";
const PERIOD = { periodStart: 1_000, periodEnd: 2_000 };

type T = ReturnType<typeof convexTest>;
let t: T;

beforeEach(() => {
  t = convexTest(schema, modules);
});

const newRun = (instanceId = INSTANCE_ID) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER_ID, instanceId, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    return await ctx.db.insert("runs", {
      jobId, ownerId: OWNER_ID, instanceId, templateId: "tpl", agentName: "strategy", sessionKey: `s-${Math.random()}`,
      status: "running", createdAt: now, updatedAt: now,
    });
  });

const newFamily = (instanceId = INSTANCE_ID, status?: "active" | "archived") =>
  t.run(async (ctx) => await ctx.db.insert("creativeFamilies", { instanceId, slug: `f-${Math.random()}`, name: "Family", description: "d", ...(status ? { status } : {}) }));

const newRecipe = (instanceId = INSTANCE_ID) =>
  t.run(async (ctx) => {
    const creativeFamilyId = await ctx.db.insert("creativeFamilies", { instanceId, slug: `f-${Math.random()}`, name: "Family", description: "d" });
    return await ctx.db.insert("productionRecipes", { instanceId, creativeFamilyId, templateId: "tpl", missionType: "make_reel", name: "Recipe", description: "d", status: "active" } as never);
  });

const newPublication = (instanceId = INSTANCE_ID) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", { ownerId: OWNER_ID, instanceId, templateId: "tpl", type: "make_reel", payload: {}, status: "done", createdAt: now, updatedAt: now });
    return await ctx.db.insert("publications", { missionId, instanceId, target: "instagram:me", status: "published", createdAt: now, updatedAt: now });
  });

type Envelope = unknown;
const ok = (extra: Partial<{ report: string; consolidatedMemory: string; references: unknown }> = {}): Envelope => ({
  report: "Report", consolidatedMemory: "Memory", references: { familyIds: [], recipeIds: [], publicationIds: [] }, ...extra,
});

async function persist(runId: Id<"runs">, envelope: Envelope, baseReviewId?: Id<"strategicReviews">, instanceId = INSTANCE_ID) {
  return await t.mutation(internal.strategic_reviews.persist, { instanceId, runId, ...(baseReviewId ? { baseReviewId } : {}), ...PERIOD, envelope });
}
const count = () => t.run(async (ctx) => (await ctx.db.query("strategicReviews").collect()).length);
const latest = (instanceId = INSTANCE_ID) => t.query(internal.strategic_reviews.latestByInstance, { instanceId });

function created(result: Awaited<ReturnType<typeof persist>>) {
  if (!result.ok) throw new Error(`expected persisted, got ${result.reason}: ${result.message}`);
  return result;
}

describe("strategic_reviews.persist", () => {
  it("persists the first review with no base, the given period and the Project's ownership", async () => {
    const run = await newRun();
    const result = created(await persist(run, ok()));
    expect(result.created).toBe(true);
    const review = await latest();
    expect(review).toMatchObject({
      _id: result.reviewId, instanceId: INSTANCE_ID, ownerId: OWNER_ID, runId: run, ...PERIOD,
      report: "Report", consolidatedMemory: "Memory", memoryChanged: true,
      references: { familyIds: [], recipeIds: [], publicationIds: [] },
    });
    expect(review?.baseReviewId).toBeUndefined();
  });

  it("accepts an empty memory on the first review and reports it unchanged", async () => {
    const run = await newRun();
    created(await persist(run, ok({ consolidatedMemory: "" })));
    expect((await latest())?.memoryChanged).toBe(false);
  });

  it("rejects an empty or blank report, a non-string report and a malformed envelope, writing nothing", async () => {
    const run = await newRun();
    for (const bad of [ok({ report: "" }), ok({ report: "  \n " }), ok({ report: 3 as never }), ok({ consolidatedMemory: null as never }), null, "text", [], {}, ok({ references: "x" }), ok({ references: { familyIds: "x" } })]) {
      const result = await persist(run, bad);
      expect(result).toMatchObject({ ok: false, reason: "invalid_result" });
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
    expect(await count()).toBe(0);
  });

  it("enforces the size limits and nothing else", async () => {
    const run = await newRun();
    const { reportChars, memoryChars, referencesPerType } = STRATEGIC_REVIEW_LIMITS;
    expect(await persist(run, ok({ report: "a".repeat(reportChars + 1) }))).toMatchObject({ ok: false, reason: "invalid_result" });
    expect(await persist(run, ok({ consolidatedMemory: "a".repeat(memoryChars + 1) }))).toMatchObject({ ok: false, reason: "invalid_result" });
    const tooMany = Array.from({ length: referencesPerType + 1 }, (_, i) => `id-${i}`);
    for (const key of ["familyIds", "recipeIds", "publicationIds"]) {
      expect(await persist(run, ok({ references: { [key]: tooMany } }))).toMatchObject({ ok: false, reason: "invalid_result" });
    }
    expect(await count()).toBe(0);
    created(await persist(run, ok({ report: "a".repeat(reportChars), consolidatedMemory: "b".repeat(memoryChars) })));
  });

  it("stores deduplicated references to existing entities of the Project, archived ones included", async () => {
    const run = await newRun();
    const family = await newFamily();
    const archived = await newFamily(INSTANCE_ID, "archived");
    const recipe = await newRecipe();
    const publication = await newPublication();
    const result = created(await persist(run, ok({ references: { familyIds: [family, archived, family], recipeIds: [recipe], publicationIds: [publication, publication] } })));
    const review = await latest();
    expect(review?._id).toBe(result.reviewId);
    expect(review?.references).toEqual({ familyIds: [family, archived], recipeIds: [recipe], publicationIds: [publication] });
  });

  it("rejects the whole result naming unknown and cross-Project references", async () => {
    const run = await newRun();
    const foreign = await newFamily(OTHER_INSTANCE_ID);
    const foreignPublication = await newPublication(OTHER_INSTANCE_ID);
    const mine = await newFamily();
    const result = await persist(run, ok({ references: { familyIds: [mine, foreign, "not-an-id"], recipeIds: [], publicationIds: [foreignPublication] } }));
    expect(result).toMatchObject({ ok: false, reason: "invalid_references" });
    if (!result.ok) {
      expect(result.message).toContain(foreign);
      expect(result.message).toContain("not-an-id");
      expect(result.message).toContain(foreignPublication);
      expect(result.message).not.toContain(mine);
    }
    expect(await count()).toBe(0);
  });

  it("accepts a reference the base already held even once its entity is deleted, but not a new missing one", async () => {
    const first = await newRun();
    const family = await newFamily();
    const base = created(await persist(first, ok({ references: { familyIds: [family], recipeIds: [], publicationIds: [] } }))).reviewId;
    await t.run(async (ctx) => await ctx.db.delete(family));
    const second = await newRun();
    const secondReview = created(await persist(second, ok({ references: { familyIds: [family], recipeIds: [], publicationIds: [] } }), base));
    const third = await newRun();
    const gone = await newFamily();
    await t.run(async (ctx) => await ctx.db.delete(gone));
    expect(await persist(third, ok({ references: { familyIds: [gone], recipeIds: [], publicationIds: [] } }), secondReview.reviewId)).toMatchObject({ ok: false, reason: "invalid_references" });
  });

  it("rejects a result based on an outdated base as a memory conflict and writes nothing", async () => {
    const a = created(await persist(await newRun(), ok())).reviewId;
    const b = created(await persist(await newRun(), ok({ report: "second" }), a)).reviewId;
    expect(await persist(await newRun(), ok({ report: "stale" }), a)).toMatchObject({ ok: false, reason: "memory_conflict" });
    expect(await persist(await newRun(), ok({ report: "none" }))).toMatchObject({ ok: false, reason: "memory_conflict" });
    expect(await count()).toBe(2);
    expect((await latest())?._id).toBe(b);
  });

  it("returns the existing review when the same Run persists twice, even after a newer review exists", async () => {
    const run = await newRun();
    const first = created(await persist(run, ok()));
    const again = created(await persist(run, ok({ report: "other" })));
    expect(again).toMatchObject({ reviewId: first.reviewId, created: false });
    created(await persist(await newRun(), ok(), first.reviewId));
    const late = created(await persist(run, ok()));
    expect(late).toMatchObject({ reviewId: first.reviewId, created: false });
    expect(await count()).toBe(2);
  });

  it("computes memoryChanged against the base, ignoring line endings and trailing whitespace, never from the input", async () => {
    const a = created(await persist(await newRun(), ok({ consolidatedMemory: "# Memory\n\nLine one\nLine two" }))).reviewId;
    const same = created(await persist(await newRun(), { ...(ok({ consolidatedMemory: "# Memory\r\n\r\nLine one\r\nLine two  \r\n\r\n" }) as object), memoryChanged: true }, a));
    expect((await latest())?.memoryChanged).toBe(false);
    expect((await latest())?.consolidatedMemory).toBe("# Memory\r\n\r\nLine one\r\nLine two  \r\n\r\n");
    created(await persist(await newRun(), { ...(ok({ consolidatedMemory: "# Memory\n\nLine one\nLine three" }) as object), memoryChanged: false }, same.reviewId));
    expect((await latest())?.memoryChanged).toBe(true);
  });

  it("scopes reads to the Project and refuses a Run of another Project", async () => {
    const run = await newRun();
    const { reviewId } = created(await persist(run, ok()));
    expect(await latest(OTHER_INSTANCE_ID)).toBeNull();
    expect(await t.query(internal.strategic_reviews.getById, { instanceId: OTHER_INSTANCE_ID, reviewId })).toBeNull();
    expect((await t.query(internal.strategic_reviews.getById, { instanceId: INSTANCE_ID, reviewId }))?._id).toBe(reviewId);
    const foreignRun = await newRun(OTHER_INSTANCE_ID);
    expect(await persist(foreignRun, ok())).toMatchObject({ ok: false, reason: "invalid_result" });
    expect(await count()).toBe(1);
  });

  it("exposes no way to change or remove a review", async () => {
    const mod = await import("../strategic_reviews.js");
    expect(Object.keys(mod).sort()).toEqual(["getById", "latestByInstance", "persist", "readStrategicMemory"]);
  });
});
