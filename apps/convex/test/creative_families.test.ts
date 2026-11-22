import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../creative_families.ts": () => import("../creative_families.js"),
};

const INSTANCE_ID = "instance-fam";
const OTHER_INSTANCE_ID = "instance-fam-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-fam", subject: "owner-fam" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-fam", subject: "stranger-fam" };
const TEMPLATE_ID = "sources-fixture";
const FIRST_PAGE = { numItems: 50, cursor: null };

beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], [loadFixtureTemplate(TEMPLATE_ID)]);
});
afterEach(() => {
  restoreRegistry();
});

type T = ReturnType<typeof convexTest>;

async function seedInstances(t: T) {
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: "job-fam", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject,
    });
    await insertInstance(ctx, {
      jobId: "job-fam-2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject,
    });
  });
}

async function family(t: T, fields: Record<string, unknown> = {}, instanceId = INSTANCE_ID) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("creativeFamilies", {
        instanceId,
        slug: `slug-${Math.random()}`,
        name: "Family",
        description: "A shared mechanic",
        ...fields,
      } as never),
  );
}

async function source(t: T, row: Record<string, unknown> = {}, instanceId = INSTANCE_ID, ownerId = OWNER.subject) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("sources", {
        instanceId,
        ownerId,
        templateId: TEMPLATE_ID,
        sourceId: "keyword",
        label: "Keyword",
        family: "search",
        status: "ready",
        origin: "https://example.com",
        capturedAt: 1000,
        createdAt: 1000,
        marketing: {},
        analysis: { query: "x" },
        ...row,
      } as never),
  );
}

describe("creativeFamilies.list", () => {
  it("lists families with their Source count, three recent Sources and an active status by default", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const a = await family(t, { name: "A" });
    await family(t, { name: "Empty" });
    for (let i = 0; i < 4; i++) {
      await source(t, { creativeFamilyId: a, createdAt: 2000 + i, origin: `o${i}`, raw: "big", rawData: "bigger" });
    }
    const result = await t.withIdentity(OWNER).query(api.creative_families.list, { instanceId: INSTANCE_ID });
    const fa = result.find((f) => f.name === "A")!;
    expect(fa.status).toBe("active");
    expect(fa.sourceCount).toBe(4);
    expect(fa.sourceCountCapped).toBe(false);
    expect(fa.recentSources.map((s) => s.origin)).toEqual(["o3", "o2", "o1"]);
    expect(fa.recentSources[0]).not.toHaveProperty("raw");
    expect(fa.recentSources[0]).not.toHaveProperty("rawData");
    expect(fa.recentSources[0]!.thumbnailUrl).toBeNull();
    expect(result.find((f) => f.name === "Empty")!.sourceCount).toBe(0);
  });

  it("reports archived and merged families", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const dest = await family(t, { name: "Dest" });
    await family(t, { name: "Old", status: "archived", mergedIntoId: dest });
    const result = await t.withIdentity(OWNER).query(api.creative_families.list, { instanceId: INSTANCE_ID });
    const old = result.find((f) => f.name === "Old")!;
    expect(old.status).toBe("archived");
    expect(old.mergedIntoId).toBe(dest);
  });

  it("caps the count at 100 and says so", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("sources", {
          instanceId: INSTANCE_ID, ownerId: OWNER.subject, templateId: TEMPLATE_ID, sourceId: "keyword",
          label: "K", family: "search", status: "ready", origin: `o${i}`, capturedAt: i, createdAt: i,
          marketing: {}, analysis: {}, creativeFamilyId: f,
        } as never);
      }
    });
    const [only] = await t.withIdentity(OWNER).query(api.creative_families.list, { instanceId: INSTANCE_ID });
    expect(only!.sourceCount).toBe(100);
    expect(only!.sourceCountCapped).toBe(true);
  });

  it("returns nothing to a stranger and never another Instance's families", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    await family(t, { name: "Mine" });
    await family(t, { name: "Theirs" }, OTHER_INSTANCE_ID);
    expect(await t.withIdentity(STRANGER).query(api.creative_families.list, { instanceId: INSTANCE_ID })).toEqual([]);
    const mine = await t.withIdentity(OWNER).query(api.creative_families.list, { instanceId: INSTANCE_ID });
    expect(mine.map((f) => f.name)).toEqual(["Mine"]);
  });
});

describe("creativeFamilies.get", () => {
  it("reads one family for its owner", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const id = await family(t, { name: "A", description: "Mechanic" });
    const got = await t.withIdentity(OWNER).query(api.creative_families.get, { instanceId: INSTANCE_ID, familyId: id });
    expect(got).toMatchObject({ name: "A", description: "Mechanic", status: "active" });
  });

  it("treats a stranger and a family of another Instance as not found", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const mine = await family(t);
    const theirs = await family(t, {}, OTHER_INSTANCE_ID);
    expect(
      await t.withIdentity(STRANGER).query(api.creative_families.get, { instanceId: INSTANCE_ID, familyId: mine }),
    ).toBeNull();
    expect(
      await t.withIdentity(OWNER).query(api.creative_families.get, { instanceId: INSTANCE_ID, familyId: theirs }),
    ).toBeNull();
  });
});

describe("creativeFamilies.listSources", () => {
  it("lists a family's Sources newest first, without raw captures, with a thumbnail URL", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    const other = await family(t);
    await source(t, { creativeFamilyId: f, createdAt: 1, origin: "old" });
    await source(t, { creativeFamilyId: f, createdAt: 2, origin: "new", raw: "x", rawData: "y" });
    await source(t, { creativeFamilyId: other, origin: "elsewhere" });
    await source(t, { origin: "none" });
    const result = await t
      .withIdentity(OWNER)
      .query(api.creative_families.listSources, { instanceId: INSTANCE_ID, familyId: f, paginationOpts: FIRST_PAGE });
    expect(result.page.map((s) => s.origin)).toEqual(["new", "old"]);
    expect(result.page[0]).not.toHaveProperty("raw");
    expect(result.page[0]).not.toHaveProperty("rawData");
    expect(result.page[0]).toHaveProperty("thumbnailUrl", null);
  });

  it("is empty for a stranger and for a family of another Instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const mine = await family(t);
    const theirs = await family(t, {}, OTHER_INSTANCE_ID);
    await source(t, { creativeFamilyId: mine });
    await source(t, { creativeFamilyId: theirs }, OTHER_INSTANCE_ID, STRANGER.subject);
    const asStranger = await t
      .withIdentity(STRANGER)
      .query(api.creative_families.listSources, { instanceId: INSTANCE_ID, familyId: mine, paginationOpts: FIRST_PAGE });
    expect(asStranger.page).toEqual([]);
    const crossed = await t
      .withIdentity(OWNER)
      .query(api.creative_families.listSources, { instanceId: INSTANCE_ID, familyId: theirs, paginationOpts: FIRST_PAGE });
    expect(crossed.page).toEqual([]);
    expect(crossed.isDone).toBe(true);
  });
});

describe("creativeFamilies.listUnclassified", () => {
  it("holds only Sources without a family, each returned once across pages", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    await source(t, { creativeFamilyId: f, origin: "classified" });
    await source(t, { origin: "theirs" }, INSTANCE_ID, STRANGER.subject);
    for (let i = 0; i < 5; i++) await source(t, { createdAt: 10 + i, origin: `u${i}` });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const res: { page: Array<{ origin: string }>; isDone: boolean; continueCursor: string } = await t
        .withIdentity(OWNER)
        .query(api.creative_families.listUnclassified, {
          instanceId: INSTANCE_ID,
          paginationOpts: { numItems: 2, cursor },
        });
      seen.push(...res.page.map((s) => s.origin));
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(seen).toEqual(["u4", "u3", "u2", "u1", "u0"]);
  });

  it("is empty for a stranger", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    await source(t);
    const res = await t
      .withIdentity(STRANGER)
      .query(api.creative_families.listUnclassified, { instanceId: INSTANCE_ID, paginationOpts: FIRST_PAGE });
    expect(res.page).toEqual([]);
  });
});

describe("creativeFamilies.stats", () => {
  const stats = (t: T, identity: typeof OWNER, familyId: unknown) =>
    t.withIdentity(identity).query(api.creative_families.stats, { instanceId: INSTANCE_ID, familyId: familyId as never });

  it("computes median and maximum over the Sources that have views only", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    for (const analysis of [{ viewCount: 100 }, { viewCount: 300 }, { viewCount: 200 }, { viewCount: 400 }, {}, { likeCount: 9 }]) {
      await source(t, { creativeFamilyId: f, analysis });
    }
    expect(await stats(t, OWNER, f)).toEqual({
      sourceCount: 6, withViewsCount: 4, medianViews: 250, maxViews: 400, truncated: false,
    });
  });

  it("reports unknown, not zero, when no Source has views", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    await source(t, { creativeFamilyId: f, analysis: { query: "x" } });
    const empty = await family(t);
    expect(await stats(t, OWNER, f)).toMatchObject({ sourceCount: 1, withViewsCount: 0, medianViews: null, maxViews: null });
    expect(await stats(t, OWNER, empty)).toMatchObject({ sourceCount: 0, withViewsCount: 0, medianViews: null, maxViews: null });
  });

  it("keeps a recorded zero view count as known", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    await source(t, { creativeFamilyId: f, analysis: { viewCount: 0 } });
    expect(await stats(t, OWNER, f)).toMatchObject({ withViewsCount: 1, medianViews: 0, maxViews: 0 });
  });

  it("flags a family above 500 Sources as truncated", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 501; i++) {
        await ctx.db.insert("sources", {
          instanceId: INSTANCE_ID, ownerId: OWNER.subject, templateId: TEMPLATE_ID, sourceId: "keyword", label: "K",
          family: "search", status: "ready", origin: `o${i}`, capturedAt: 1, createdAt: i, marketing: {},
          analysis: { viewCount: 1 }, creativeFamilyId: f,
        } as never);
      }
    });
    expect(await stats(t, OWNER, f)).toMatchObject({ sourceCount: 500, truncated: true });
  });

  it("is refused for a stranger and for a family of another Instance", async () => {
    const t = convexTest(schema, modules);
    await seedInstances(t);
    const f = await family(t);
    const foreign = await family(t, {}, OTHER_INSTANCE_ID);
    expect(await stats(t, STRANGER, f)).toBeNull();
    expect(await stats(t, OWNER, foreign)).toBeNull();
  });
});
