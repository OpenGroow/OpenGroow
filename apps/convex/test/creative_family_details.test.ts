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
  "../creative_family_details.ts": () => import("../creative_family_details.js"),
};

const INSTANCE_ID = "instance-detail";
const OTHER_INSTANCE_ID = "instance-detail-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-detail", subject: "owner-detail" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-detail", subject: "stranger-detail" };

beforeEach(() => {
  restoreRegistry = installTemplateRegistry([INSTANCE_ID, OTHER_INSTANCE_ID], [loadFixtureTemplate("sources-fixture")]);
});
afterEach(() => {
  restoreRegistry();
});

async function seed() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "j1", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "j2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
  return t;
}

const create = (t: Awaited<ReturnType<typeof seed>>, name: string, description = "A mechanic", identity = OWNER, instanceId = INSTANCE_ID) =>
  t.withIdentity(identity).mutation(api.creative_family_details.create, { instanceId, name, description });

describe("creative_family_details.create", () => {
  it("creates an active family with a slug derived from the name", async () => {
    const t = await seed();
    const id = await create(t, "  Silent Reaction  ", "Close-up reaction");
    const family = await t.withIdentity(OWNER).query(api.creative_families.get, { instanceId: INSTANCE_ID, familyId: id });
    expect(family).toMatchObject({ name: "Silent Reaction", description: "Close-up reaction", slug: "silent-reaction", status: "active" });
  });

  it("refuses a name equal to an existing one ignoring case and accents, archived included", async () => {
    const t = await seed();
    await create(t, "Réaction Silencieuse");
    await t.run(async (ctx) => {
      await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "old", name: "Hook Zoom", description: "d", status: "archived" });
    });
    await expect(create(t, "reaction silencieuse")).rejects.toThrow(/already exists/);
    await expect(create(t, "HOOK ZOOM")).rejects.toThrow(/already exists/);
  });

  it("refuses a name whose slug already exists", async () => {
    const t = await seed();
    await t.run(async (ctx) => {
      await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "hook-zoom", name: "Other name", description: "d" });
    });
    await expect(create(t, "Hook, Zoom!")).rejects.toThrow(/already exists/);
  });

  it("allows the same name in another Instance", async () => {
    const t = await seed();
    await create(t, "Reaction");
    await expect(create(t, "Reaction", "d", STRANGER, OTHER_INSTANCE_ID)).resolves.toBeTruthy();
  });

  it("refuses an empty name or description, and a name with no letters", async () => {
    const t = await seed();
    await expect(create(t, "   ")).rejects.toThrow();
    await expect(create(t, "Name", "  ")).rejects.toThrow();
    await expect(create(t, "!!!")).rejects.toThrow();
  });

  it("is refused for a stranger", async () => {
    const t = await seed();
    await expect(create(t, "Reaction", "d", STRANGER)).rejects.toThrow("Forbidden");
  });
});

describe("creative_family_details.update", () => {
  it("renames and redescribes a family and keeps its slug", async () => {
    const t = await seed();
    const id = await create(t, "Reaction");
    await t.withIdentity(OWNER).mutation(api.creative_family_details.update, {
      instanceId: INSTANCE_ID, familyId: id, name: "Silent Reaction", description: "New mechanic",
    });
    const family = await t.withIdentity(OWNER).query(api.creative_families.get, { instanceId: INSTANCE_ID, familyId: id });
    expect(family).toMatchObject({ name: "Silent Reaction", description: "New mechanic", slug: "reaction" });
  });

  it("refuses a name taken by another family, archived included, but not the family's own name", async () => {
    const t = await seed();
    const a = await create(t, "Alpha");
    await t.run(async (ctx) => {
      await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "beta", name: "Beta", description: "d", status: "archived" });
    });
    const update = (name: string) =>
      t.withIdentity(OWNER).mutation(api.creative_family_details.update, { instanceId: INSTANCE_ID, familyId: a, name, description: "d" });
    await expect(update("beta")).rejects.toThrow(/already exists/);
    await expect(update("ALPHA")).resolves.toBeNull();
  });

  it("is refused for a stranger and across Instances", async () => {
    const t = await seed();
    const id = await create(t, "Reaction");
    const args = { familyId: id, name: "X", description: "d" };
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_family_details.update, { instanceId: INSTANCE_ID, ...args }),
    ).rejects.toThrow("Forbidden");
    await expect(
      t.withIdentity(STRANGER).mutation(api.creative_family_details.update, { instanceId: OTHER_INSTANCE_ID, ...args }),
    ).rejects.toThrow(/not found/);
  });
});
