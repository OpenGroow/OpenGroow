import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

let restoreRegistry: () => void;

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../creative_family_merge.ts": () => import("../creative_family_merge.js"),
};

const INSTANCE_ID = "instance-merge";
const OTHER_INSTANCE_ID = "instance-merge-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-merge", subject: "owner-merge" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-merge", subject: "stranger-merge" };
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
      await ctx.db.insert("creativeFamilies", { instanceId, slug: `s-${Math.random()}`, name: "F", description: "d", ...fields } as never),
  );
}

async function sources(t: T, familyId: unknown, count: number, instanceId = INSTANCE_ID, ownerId = OWNER.subject) {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("sources", {
        instanceId, ownerId, templateId: TEMPLATE_ID, sourceId: "keyword", label: "K", family: "search",
        status: "ready", origin: `o${i}`, capturedAt: i, createdAt: i, marketing: {}, analysis: {}, creativeFamilyId: familyId,
      } as never);
    }
  });
}

const countIn = (t: T, familyId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("sources").collect()).filter((s) => s.creativeFamilyId === familyId).length);

describe("creative_family_merge.merge", () => {
  it("moves a family of more than 100 Sources in batches, archiving the source only when none remain", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const from = await family(t);
    const into = await family(t);
    await sources(t, from, 230);
    const owner = t.withIdentity(OWNER);

    const first = await owner.mutation(api.creative_family_merge.merge, { instanceId: INSTANCE_ID, fromFamilyId: from, intoFamilyId: into });
    expect(first.moved).toBe(100);
    expect(first.remaining).toBeGreaterThan(0);
    expect((await t.run((ctx) => ctx.db.get(from)))!.status).toBeUndefined();

    // Interrupted here: calling again resumes.
    let last = first;
    let calls = 1;
    while (last.remaining > 0) {
      last = await owner.mutation(api.creative_family_merge.merge, { instanceId: INSTANCE_ID, fromFamilyId: from, intoFamilyId: into });
      calls++;
    }
    expect(calls).toBe(3);
    expect(await countIn(t, into)).toBe(230);
    expect(await countIn(t, from)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("sources").collect()).length)).toBe(230);
    const archived = (await t.run((ctx) => ctx.db.get(from)))!;
    expect(archived.status).toBe("archived");
    expect(archived.mergedIntoId).toBe(into);
  });

  it("moves the Sources of every owner of the Instance before archiving", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const from = await family(t);
    const into = await family(t);
    await sources(t, from, 2);
    await sources(t, from, 3, INSTANCE_ID, OWNER.tokenIdentifier);
    const result = await t
      .withIdentity(OWNER)
      .mutation(api.creative_family_merge.merge, { instanceId: INSTANCE_ID, fromFamilyId: from, intoFamilyId: into });
    expect(result).toEqual({ moved: 5, remaining: 0 });
    expect(await countIn(t, into)).toBe(5);
    expect(await countIn(t, from)).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(from)))!.status).toBe("archived");
  });

  it("archives an empty family at once and is a no-op when run again", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const from = await family(t);
    const into = await family(t);
    const owner = t.withIdentity(OWNER);
    const args = { instanceId: INSTANCE_ID, fromFamilyId: from, intoFamilyId: into };
    expect(await owner.mutation(api.creative_family_merge.merge, args)).toEqual({ moved: 0, remaining: 0 });
    expect(await owner.mutation(api.creative_family_merge.merge, args)).toEqual({ moved: 0, remaining: 0 });
    expect((await t.run((ctx) => ctx.db.get(from)))!.mergedIntoId).toBe(into);
  });

  it("refuses the same family, an archived target, another Instance's family and a stranger", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const a = await family(t);
    const b = await family(t);
    const archived = await family(t, { status: "archived" });
    const foreign = await family(t, {}, OTHER_INSTANCE_ID);
    await sources(t, a, 2);
    const owner = t.withIdentity(OWNER);
    const base = { instanceId: INSTANCE_ID, fromFamilyId: a };
    await expect(owner.mutation(api.creative_family_merge.merge, { ...base, intoFamilyId: a })).rejects.toThrow();
    await expect(owner.mutation(api.creative_family_merge.merge, { ...base, intoFamilyId: archived })).rejects.toThrow();
    await expect(owner.mutation(api.creative_family_merge.merge, { ...base, intoFamilyId: foreign })).rejects.toThrow();
    await expect(owner.mutation(api.creative_family_merge.merge, { instanceId: INSTANCE_ID, fromFamilyId: foreign, intoFamilyId: b })).rejects.toThrow();
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_family_merge.merge, { ...base, intoFamilyId: b }),
    ).rejects.toThrow();
    expect(await countIn(t, a)).toBe(2);
  });
});
