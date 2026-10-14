import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal, api } from "../_generated/api";
import schema from "../schema";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instances.ts": () => import("../instances.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

const NOW = new Date().toISOString();
const OWNER = "tok|owner-1";

function legacyInstance(over: Record<string, unknown>) {
  return { status: "succeeded" as const, createdAt: NOW, updatedAt: NOW, ...over } as any;
}

describe("projects table (issue #724)", () => {
  it("creates the Project at the first moment of a local creation, keyed by the Instance id", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.createLocalInstance, {
      userId: OWNER,
      jobId: "local-abc",
      port: 18001,
      openclawKeyId: "key-1",
    });
    const { project, instance } = await t.run(async (ctx) => ({
      project: await ctx.db.query("projects").first(),
      instance: await ctx.db.query("instances").first(),
    }));
    expect(project?.projectId).toBe("local-abc");
    expect(project?.ownerId).toBe(OWNER);
    expect(instance?.projectId).toBe(project?._id);
  });

  it("creates the Project before the OpenClaw id exists and keeps its identity once it arrives", async () => {
    const t = convexTest(schema, modules);
    const job = { id: "job-1", status: "running" as const, runtimeStatus: "provisioning" as const, createdAt: NOW };
    await t.mutation(internal.instances.saveJob, { job: job as any, status: 200, userId: OWNER });
    const before = await t.run(async (ctx) => await ctx.db.query("projects").collect());
    expect(before).toHaveLength(1);
    expect(before[0].projectId).toBeUndefined();

    const withId = { ...job, openclaw: { serverId: 1, name: "n", openClawId: "oc-1", openClawKeyId: "k" } };
    await t.mutation(internal.instances.saveJob, { job: withId as any, status: 200 });
    // A later change of the runtime id (re-provisioning) never moves the Project id.
    await t.mutation(internal.instances.saveJob, {
      job: { ...withId, openclaw: { ...withId.openclaw, openClawId: "oc-2" } } as any,
      status: 200,
    });
    const after = await t.run(async (ctx) => await ctx.db.query("projects").collect());
    expect(after).toHaveLength(1);
    expect(after[0]._id).toBe(before[0]._id);
    expect(after[0].projectId).toBe("oc-1");
    expect(after[0].ownerId).toBe(OWNER);
  });

  it("renames through the Project and lists the Project's name", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.createLocalInstance, {
      userId: OWNER, jobId: "local-r", port: 1, openclawKeyId: "k",
    });
    const asOwner = t.withIdentity({ subject: "owner-1", tokenIdentifier: OWNER });
    await asOwner.mutation(api.instances.renameInstance, { jobId: "local-r", displayName: "  My Project " });
    const project = await t.run(async (ctx) => await ctx.db.query("projects").first());
    expect(project?.displayName).toBe("My Project");
    const listed = await asOwner.query(api.instances.list, {});
    expect(listed[0].displayName).toBe("My Project");
  });

  it("deleting the Instance deletes its Project", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.createLocalInstance, {
      userId: OWNER, jobId: "local-d", port: 1, openclawKeyId: "k",
    });
    await t.mutation(internal.instances.deleteByJobId, { jobId: "local-d" });
    expect(await t.run(async (ctx) => await ctx.db.query("projects").collect())).toHaveLength(0);
  });
});

describe("projects table review fixes (#724)", () => {
  const job = (over: Record<string, unknown> = {}) =>
    ({ id: "job-r", status: "running", runtimeStatus: "provisioning", createdAt: NOW, ...over }) as any;

  it("saveJob keeps the Project's owner in step with the caller", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.saveJob, { job: job(), status: 200, userId: OWNER });
    await t.mutation(internal.instances.saveJob, { job: job(), status: 200, userId: "tok|owner-2" });
    const project = await t.run(async (ctx) => await ctx.db.query("projects").first());
    expect(project?.ownerId).toBe("tok|owner-2");
  });

  it("a saveJob without userId does not unset the owner", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.saveJob, { job: job(), status: 200, userId: OWNER });
    await t.mutation(internal.instances.saveJob, { job: job(), status: 200 });
    const project = await t.run(async (ctx) => await ctx.db.query("projects").first());
    expect(project?.ownerId).toBe(OWNER);
  });

  it("deleting one Instance keeps a Project another Instance still runs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("instances", legacyInstance({ jobId: "a", projectId }));
      await ctx.db.insert("instances", legacyInstance({ jobId: "b", projectId }));
    });
    await t.mutation(internal.instances.deleteByJobId, { jobId: "a" });
    expect(await t.run(async (ctx) => await ctx.db.query("projects").collect())).toHaveLength(1);
    await t.mutation(internal.instances.deleteByJobId, { jobId: "b" });
    expect(await t.run(async (ctx) => await ctx.db.query("projects").collect())).toHaveLength(0);
  });

  it("refuses to rename a Project owned by someone else", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.instances.createLocalInstance, {
      userId: OWNER, jobId: "local-x", port: 1, openclawKeyId: "k",
    });
    const stranger = t.withIdentity({ subject: "other", tokenIdentifier: "tok|other" });
    await expect(
      stranger.mutation(api.instances.renameInstance, { jobId: "local-x", displayName: "Mine" }),
    ).rejects.toThrow("Forbidden");
  });
});
