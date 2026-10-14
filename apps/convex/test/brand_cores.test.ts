import { insertInstance } from "./instance_fixture";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../brand_cores.ts": () => import("../brand_cores.js"),
};

const INSTANCE_ID = "openclaw-brand-core";

const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  tokenIdentifier: "test|brand-owner",
  subject: "brand-owner",
};
const STRANGER = {
  name: "Stranger",
  email: "stranger@example.com",
  tokenIdentifier: "test|brand-stranger",
  subject: "brand-stranger",
};

async function seedProject(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
}

describe("brand_cores", () => {
  it("lets the owner read and upsert one Brand Core per Project", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toEqual(null);

    await t.withIdentity(OWNER).mutation(api.brand_cores.upsert, {
      instanceId: INSTANCE_ID,
      audience: "Small business founders",
    });

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toMatchObject({
      instanceId: INSTANCE_ID,
      audience: "Small business founders",
    });

    await t.withIdentity(OWNER).mutation(api.brand_cores.upsert, {
      instanceId: INSTANCE_ID,
      audience: "",
    });

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toMatchObject({
      instanceId: INSTANCE_ID,
      audience: "",
    });

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("brandCores")
        .withIndex("by_instance", (q) => q.eq("instanceId", INSTANCE_ID))
        .take(2);
      expect(rows).toHaveLength(1);
    });
  });

  it("does not expose the Project Brand Core to non-owners", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);

    await t.withIdentity(OWNER).mutation(api.brand_cores.upsert, {
      instanceId: INSTANCE_ID,
      audience: "Existing audience",
    });

    await expect(
      t.withIdentity(STRANGER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toEqual(null);

    await expect(
      t.withIdentity(STRANGER).mutation(api.brand_cores.upsert, {
        instanceId: INSTANCE_ID,
        audience: "Overwritten",
      }),
    ).rejects.toThrow("Forbidden");

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toMatchObject({ audience: "Existing audience" });
  });

  it("saves and reloads a partial full-rubric Brand Core", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);

    await t.withIdentity(OWNER).mutation(api.brand_cores.upsert, {
      instanceId: INSTANCE_ID,
      audience: "Independent shop owners",
      tone: "Clear and direct",
      offer: "",
      positioning: "Practical automation partner",
      editorialRules: "Use concrete examples",
      constraints: "",
      avoid: "Empty hype",
      notes: "Seasonal campaigns matter",
    });

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toMatchObject({
      instanceId: INSTANCE_ID,
      audience: "Independent shop owners",
      tone: "Clear and direct",
      offer: "",
      positioning: "Practical automation partner",
      editorialRules: "Use concrete examples",
      constraints: "",
      avoid: "Empty hype",
      notes: "Seasonal campaigns matter",
    });

    await t.withIdentity(OWNER).mutation(api.brand_cores.upsert, {
      instanceId: INSTANCE_ID,
      audience: "Independent shop owners",
      tone: "",
      offer: "Done-for-you workflows",
      positioning: "",
      editorialRules: "",
      constraints: "No unverifiable claims",
      avoid: "",
      notes: "",
    });

    await expect(
      t.withIdentity(OWNER).query(api.brand_cores.get, { instanceId: INSTANCE_ID }),
    ).resolves.toMatchObject({
      audience: "Independent shop owners",
      tone: "",
      offer: "Done-for-you workflows",
      positioning: "",
      editorialRules: "",
      constraints: "No unverifiable claims",
      avoid: "",
      notes: "",
    });
  });
});
