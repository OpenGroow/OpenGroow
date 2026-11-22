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
  "../creative_families_archive.ts": () => import("../creative_families_archive.js"),
};

const INSTANCE_ID = "instance-arch";
const OTHER_INSTANCE_ID = "instance-arch-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-arch", subject: "owner-arch" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-arch", subject: "stranger-arch" };
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
    await insertInstance(ctx, { jobId: "job-a", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-b", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
}

async function family(t: T, fields: Record<string, unknown> = {}, instanceId = INSTANCE_ID) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("creativeFamilies", { instanceId, slug: `slug-${Math.random()}`, name: "Family", description: "Mechanic", ...fields } as never),
  );
}

async function source(t: T, creativeFamilyId: unknown) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("sources", {
        instanceId: INSTANCE_ID, ownerId: OWNER.subject, templateId: TEMPLATE_ID, sourceId: "keyword", label: "K", family: "search",
        status: "ready", origin: "https://example.com", capturedAt: 1, createdAt: 1, marketing: {}, analysis: {}, creativeFamilyId,
      } as never),
  );
}

const listed = (t: T) => t.withIdentity(OWNER).query(api.creative_families.list, { instanceId: INSTANCE_ID });

describe("creative_families_archive", () => {
  it("archives a family and keeps its Sources listed, then unarchives it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const f = await family(t);
    await source(t, f);
    await t.withIdentity(OWNER).mutation(api.creative_families_archive.archive, { instanceId: INSTANCE_ID, familyId: f });
    let [row] = await listed(t);
    expect(row!.status).toBe("archived");
    expect(row!.sourceCount).toBe(1);
    const page = await t.withIdentity(OWNER).query(api.creative_families.listSources, {
      instanceId: INSTANCE_ID, familyId: f, paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    await t.withIdentity(OWNER).mutation(api.creative_families_archive.unarchive, { instanceId: INSTANCE_ID, familyId: f });
    [row] = await listed(t);
    expect(row!.status).toBe("active");
  });

  it("is idempotent and leaves the name, slug and merge record alone", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const dest = await family(t);
    const f = await family(t, { slug: "keep", name: "Keep", status: "archived", mergedIntoId: dest });
    await t.withIdentity(OWNER).mutation(api.creative_families_archive.archive, { instanceId: INSTANCE_ID, familyId: f });
    const doc = await t.run((ctx) => ctx.db.get(f));
    expect(doc).toMatchObject({ slug: "keep", name: "Keep", status: "archived", mergedIntoId: dest });
  });

  it("refuses a stranger", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const f = await family(t);
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_families_archive.archive, { instanceId: INSTANCE_ID, familyId: f }),
    ).rejects.toThrow("Forbidden");
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_families_archive.unarchive, { instanceId: INSTANCE_ID, familyId: f }),
    ).rejects.toThrow("Forbidden");
    expect((await listed(t))[0]!.status).toBe("active");
  });

  it("refuses a family of another Instance", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const theirs = await family(t, {}, OTHER_INSTANCE_ID);
    await expect(
      t.withIdentity(OWNER).mutation(api.creative_families_archive.archive, { instanceId: INSTANCE_ID, familyId: theirs }),
    ).rejects.toThrow("Creative Family not found");
    const doc = await t.run((ctx) => ctx.db.get(theirs));
    expect(doc!.status).toBeUndefined();
  });
});
