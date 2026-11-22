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
  "../creative_family_sources.ts": () => import("../creative_family_sources.js"),
};

const INSTANCE_ID = "instance-assign";
const OTHER_INSTANCE_ID = "instance-assign-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-assign", subject: "owner-assign" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-assign", subject: "stranger-assign" };
const TEMPLATE_ID = "sources-fixture";

beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], [loadFixtureTemplate(TEMPLATE_ID)]);
});
afterEach(() => {
  restoreRegistry();
});

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "j1", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "j2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
}

async function family(t: T, fields: Record<string, unknown> = {}, instanceId = INSTANCE_ID) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("creativeFamilies", { instanceId, slug: `s-${Math.random()}`, name: "Family", description: "d", ...fields } as never),
  );
}

async function source(t: T, row: Record<string, unknown> = {}, instanceId = INSTANCE_ID, ownerId = OWNER.subject) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("sources", {
        instanceId, ownerId, templateId: TEMPLATE_ID, sourceId: "keyword", label: "Keyword", family: "search",
        status: "ready", origin: "https://example.com", capturedAt: 1, createdAt: 1, marketing: {}, analysis: {}, ...row,
      } as never),
  );
}

const familyOf = (t: T, id: never) => t.run(async (ctx) => (await ctx.db.get(id) as { creativeFamilyId?: string } | null)?.creativeFamilyId);

describe("creative_family_sources.assign", () => {
  it("assigns an unclassified Source, moves a classified one, and is a no-op when repeated", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const a = await family(t);
    const b = await family(t);
    const s = await source(t);
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: a });
    expect(await familyOf(t, s as never)).toBe(a);
    await owner.mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: a });
    expect(await familyOf(t, s as never)).toBe(a);
    await owner.mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: b });
    expect(await familyOf(t, s as never)).toBe(b);
    const inA = await owner.query(api.creative_families.listSources, { instanceId: INSTANCE_ID, familyId: a, paginationOpts: { numItems: 10, cursor: null } });
    expect(inA.page).toHaveLength(0);
  });

  it("refuses an archived family and leaves the Source unchanged", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const archived = await family(t, { status: "archived" });
    const s = await source(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: archived }),
    ).rejects.toThrow(/archived/i);
    expect(await familyOf(t, s as never)).toBeNull();
  });

  it("refuses a stranger and a family or Source of another Instance", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const a = await family(t);
    const foreignFamily = await family(t, {}, OTHER_INSTANCE_ID);
    const s = await source(t);
    const foreignSource = await source(t, {}, OTHER_INSTANCE_ID, STRANGER.subject);
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: a }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity(OWNER).mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: s, familyId: foreignFamily }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity(OWNER).mutation(api.creative_family_sources.assign, { instanceId: INSTANCE_ID, sourceId: foreignSource, familyId: a }),
    ).rejects.toThrow();
    expect(await familyOf(t, s as never)).toBeNull();
  });
});

describe("creative_family_sources.remove", () => {
  it("clears the family and keeps the Source, which becomes unclassified", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const a = await family(t);
    const s = await source(t, { creativeFamilyId: a });
    const owner = t.withIdentity(OWNER);
    await owner.mutation(api.creative_family_sources.remove, { instanceId: INSTANCE_ID, sourceId: s });
    expect(await t.run(async (ctx) => ctx.db.get(s as never))).not.toBeNull();
    const page = await owner.query(api.creative_families.listUnclassified, { instanceId: INSTANCE_ID, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((x: { _id: string }) => x._id)).toEqual([s]);
  });

  it("refuses a stranger and a Source of another Instance", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const a = await family(t);
    const s = await source(t, { creativeFamilyId: a });
    const foreign = await source(t, {}, OTHER_INSTANCE_ID, STRANGER.subject);
    await expect(t.withIdentity(STRANGER).mutation(api.creative_family_sources.remove, { instanceId: INSTANCE_ID, sourceId: s })).rejects.toThrow();
    await expect(t.withIdentity(OWNER).mutation(api.creative_family_sources.remove, { instanceId: INSTANCE_ID, sourceId: foreign })).rejects.toThrow();
    expect(await familyOf(t, s as never)).toBe(a);
  });
});
