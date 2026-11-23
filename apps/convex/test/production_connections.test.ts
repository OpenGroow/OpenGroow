import { setTemplateRegistryForTests } from "../template_registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, inMemoryRegistry, installTemplateRegistry } from "./helpers/template_registry.helpers";
import { isCompatible, validateConnectionTarget } from "../production_connection_rules";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../production_recipes.ts": () => import("../production_recipes.js"),
  "../production_connections.ts": () => import("../production_connections.js"),
};

const INSTANCE_ID = "instance-conn";
const OTHER_INSTANCE_ID = "instance-conn-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-conn", subject: "owner-conn" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-conn", subject: "stranger-conn" };

const missionType = (extra: Record<string, unknown> = {}) => ({
  type: "create_letter_video",
  label: "Letter video",
  contextProviders: ["production-recipe"],
  fields: [
    { key: "format", label: "Format", type: "select", options: [{ value: "hook", label: "Hook" }, { value: "letter", label: "Letter" }] },
    { key: "note", label: "Note", type: "text" },
  ],
  ...extra,
});
const template = (id: string, types: unknown[] = [missionType()]) => fixtureTemplate(id, { missionTypes: types } as never);

let restoreRegistry: () => void;
beforeEach(() => {
  restoreRegistry = installTemplateRegistry(
    [INSTANCE_ID, OTHER_INSTANCE_ID],
    [
      template("@example/video-a"),
      template("@example/video-b"),
      template("@example/no-provider", [missionType({ contextProviders: [] })]),
    ],
  );
});
afterEach(() => restoreRegistry());

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-a", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-b", status: "running", createdAt: now, openclawId: OTHER_INSTANCE_ID, updatedAt: now, userId: STRANGER.subject });
  });
  const familyId = await t.run((ctx) => ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: "s", name: "F", description: "d" } as never));
  const owner = t.withIdentity(OWNER);
  const { recipeId } = await owner.mutation(api.production_recipes.create, {
    instanceId: INSTANCE_ID, familyId, name: "R", description: "", instructions: "Do it.", constraints: [],
  });
  return { t, owner, recipeId };
}

describe("rules", () => {
  const manifest = { missionTypes: [missionType()] } as never;
  it("validates target, provider, fields and values", () => {
    expect(() => validateConnectionTarget(manifest, "create_letter_video", { format: ["hook"] })).not.toThrow();
    expect(() => validateConnectionTarget(manifest, "nope", {})).toThrow("does not exist");
    expect(() => validateConnectionTarget(manifest, "create_letter_video", { note: ["x"] })).toThrow("not a select field");
    expect(() => validateConnectionTarget(manifest, "create_letter_video", { format: ["video"] })).toThrow("not an option");
  });
  it("treats a missing payload field as incompatible", () => {
    expect(isCompatible({ format: ["hook"] }, { format: "hook" })).toBe(true);
    expect(isCompatible({ format: ["hook"] }, { format: "letter" })).toBe(false);
    expect(isCompatible({ format: ["hook"] }, {})).toBe(false);
    expect(isCompatible({}, {})).toBe(true);
  });
});

describe("production_connections", () => {
  it("creates a candidate connection and reads it back", async () => {
    const { owner, recipeId } = await setup();
    const id = await owner.mutation(api.production_connections.create, {
      instanceId: INSTANCE_ID, recipeId, templateId: "@example/video-a", missionType: "create_letter_video", compatibleWhen: { format: ["hook"] },
    });
    expect(await owner.query(api.production_connections.get, { instanceId: INSTANCE_ID, connectionId: id })).toMatchObject({
      status: "candidate", templateId: "@example/video-a", compatibleWhen: { format: ["hook"] },
    });
    expect(await owner.query(api.production_connections.list, { instanceId: INSTANCE_ID, recipeId })).toHaveLength(1);
  });

  it("refuses a Mission type without the provider, an unknown field and an unknown value", async () => {
    const { owner, recipeId } = await setup();
    const base = { instanceId: INSTANCE_ID, recipeId, missionType: "create_letter_video" };
    await expect(owner.mutation(api.production_connections.create, { ...base, templateId: "@example/no-provider" })).rejects.toThrow("provider");
    await expect(owner.mutation(api.production_connections.create, { ...base, templateId: "@example/video-a", compatibleWhen: { ghost: ["x"] } })).rejects.toThrow("not a select field");
    await expect(owner.mutation(api.production_connections.create, { ...base, templateId: "@example/video-a", compatibleWhen: { format: ["video"] } })).rejects.toThrow("not an option");
    await expect(owner.mutation(api.production_connections.create, { ...base, templateId: "@example/missing" })).rejects.toThrow("not installed");
  });

  it("keeps two Templates with a same-named Mission type distinct, and refuses a duplicate", async () => {
    const { owner, recipeId } = await setup();
    const args = { instanceId: INSTANCE_ID, recipeId, missionType: "create_letter_video" };
    const a = await owner.mutation(api.production_connections.create, { ...args, templateId: "@example/video-a" });
    const b = await owner.mutation(api.production_connections.create, { ...args, templateId: "@example/video-b" });
    expect(a).not.toBe(b);
    await expect(owner.mutation(api.production_connections.create, { ...args, templateId: "@example/video-a" })).rejects.toThrow("already connected");
  });

  it("changes status", async () => {
    const { owner, recipeId } = await setup();
    const id = await owner.mutation(api.production_connections.create, { instanceId: INSTANCE_ID, recipeId, templateId: "@example/video-a", missionType: "create_letter_video" });
    for (const status of ["active", "disabled", "candidate"] as const) {
      await owner.mutation(api.production_connections.setStatus, { instanceId: INSTANCE_ID, connectionId: id, status });
      expect((await owner.query(api.production_connections.get, { instanceId: INSTANCE_ID, connectionId: id }))!.status).toBe(status);
    }
  });

  it("is isolated per Project", async () => {
    const { t, owner, recipeId } = await setup();
    const id = await owner.mutation(api.production_connections.create, { instanceId: INSTANCE_ID, recipeId, templateId: "@example/video-a", missionType: "create_letter_video" });
    const stranger = t.withIdentity(STRANGER);
    await expect(stranger.mutation(api.production_connections.setStatus, { instanceId: INSTANCE_ID, connectionId: id, status: "active" })).rejects.toThrow();
    expect(await stranger.query(api.production_connections.get, { instanceId: INSTANCE_ID, connectionId: id })).toBeNull();
    expect(await stranger.query(api.production_connections.list, { instanceId: INSTANCE_ID, recipeId })).toEqual([]);
    // The stranger's own Instance cannot reach the owner's connection either.
    await expect(stranger.mutation(api.production_connections.setStatus, { instanceId: OTHER_INSTANCE_ID, connectionId: id, status: "active" })).rejects.toThrow("not found");
  });

  it("lists targets that declare the provider, with their select fields", async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      for (const templateId of ["@example/video-a", "@example/no-provider"]) {
        await ctx.db.insert("installedTemplates", { projectId: INSTANCE_ID, templateId, version: "1.0.0", origin: "hub", digest: "d", manifest: {}, current: true, installedAt: 1 } as never);
      }
    });
    const targets = await owner.query(api.production_connections.listTargets, { instanceId: INSTANCE_ID });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ templateId: "@example/video-a", missionType: "create_letter_video", selectFields: [{ key: "format" }] });
  });

  describe("staged Template version", () => {
    const stagedFormat = { ...missionType().fields[0]!, options: [{ value: "hook", label: "Hook" }, { value: "square", label: "Square" }] };
    async function setupStaged() {
      const ctx = await setup();
      // v1 (current) declares no provider; v2 (staged, not applied) does.
      const v1 = template("@example/video-staged", [missionType({ contextProviders: [] })]);
      const v2 = template("@example/video-staged", [missionType({ fields: [stagedFormat] })]);
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

    it("offers a target only the staged version declares", async () => {
      const { owner } = await setupStaged();
      const targets = await owner.query(api.production_connections.listTargets, { instanceId: INSTANCE_ID });
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({ templateId: "@example/video-staged", missionType: "create_letter_video" });
      expect(targets[0]!.selectFields[0]!.options.map((o) => o.value)).toEqual(["hook", "square"]);
    });

    it("accepts a connection validated against the staged manifest", async () => {
      const { owner, recipeId } = await setupStaged();
      const args = { instanceId: INSTANCE_ID, recipeId, templateId: "@example/video-staged", missionType: "create_letter_video" };
      await expect(owner.mutation(api.production_connections.create, { ...args, compatibleWhen: { format: ["square"] } })).resolves.toBeTruthy();
    });

    it("still refuses when no installed version declares the provider", async () => {
      const { owner, recipeId } = await setupStaged();
      setTemplateRegistryForTests(inMemoryRegistry([INSTANCE_ID], [template("@example/video-staged", [missionType({ contextProviders: [] })])]));
      await expect(
        owner.mutation(api.production_connections.create, { instanceId: INSTANCE_ID, recipeId, templateId: "@example/video-staged", missionType: "create_letter_video" }),
      ).rejects.toThrow("provider");
    });
  });
});
