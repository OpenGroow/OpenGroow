import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { runningGenerationRun, standaloneInFlight } from "../recipe_generation_shared";

// ADR-087: a Standalone Run has neither a Mission nor a Job, only a recipeGeneration pin.

const modules = { "../_generated/api.ts": () => import("../_generated/api.js") };

const base = (now: number) => ({
  ownerId: "owner",
  instanceId: "project-a",
  templateId: "example/strategist",
  agentName: "a",
  sessionKey: "s",
  status: "pending" as const,
  createdAt: now,
  updatedAt: now,
});

describe("Standalone Run schema", () => {
  it("inserts and reads back a Run with a recipeGeneration pin", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: "project-a", slug: "article-1", name: "Example", description: "" });
      const id = await ctx.db.insert("runs", {
        ...base(1),
        recipeGeneration: { familyId, instructions: "short", tryCount: 1 },
      });
      return await ctx.db.get(id);
    });
    expect(run && "recipeGeneration" in run ? run.recipeGeneration.tryCount : undefined).toBe(1);
  });

  it("finds a Project's Runs of a family through the index", async () => {
    const t = convexTest(schema, modules);
    const found = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: "project-a", slug: "article-1", name: "Example", description: "" });
      await ctx.db.insert("runs", { ...base(1), recipeGeneration: { familyId, tryCount: 1 } });
      return await ctx.db
        .query("runs")
        .withIndex("by_instance_family", (q) => q.eq("instanceId", "project-a").eq("recipeGeneration.familyId", familyId))
        .collect();
    });
    expect(found).toHaveLength(1);
  });

  it("still rejects a Run with no parent and no pin", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(async (ctx) => ctx.db.insert("runs", base(1) as never))).rejects.toThrow();
  });

  it("still rejects a Run with both parents", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        const now = 1;
        const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: "project-a", templateId: "x", type: "report", payload: {}, status: "doing", createdAt: now, updatedAt: now });
        const jobId = await ctx.db.insert("jobs", { ownerId: "owner", instanceId: "project-a", templateId: "x", type: "t", status: "active", createdAt: now, updatedAt: now } as never);
        return ctx.db.insert("runs", { ...base(now), missionId, jobId } as never);
      }),
    ).rejects.toThrow();
  });

  it("sees a Standalone Run behind more than a hundred other Runs of the Agent", async () => {
    const t = convexTest(schema, modules);
    const { inFlight, running, other } = await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("creativeFamilies", { instanceId: "project-a", slug: "article-1", name: "Example", description: "" });
      const missionId = await ctx.db.insert("missions", { ownerId: "owner", instanceId: "project-a", templateId: "example/strategist", type: "report", payload: {}, status: "doing", createdAt: 1, updatedAt: 1 });
      // The Standalone Run is the oldest: 120 Mission Runs of the Agent sit before it in each status range.
      await ctx.db.insert("runs", { ...base(1), status: "running", recipeGeneration: { familyId, tryCount: 1 } });
      for (let i = 0; i < 120; i++) await ctx.db.insert("runs", { ...base(2 + i), status: "running", missionId } as never);
      return {
        inFlight: await standaloneInFlight(ctx, "project-a", "example/strategist"),
        running: await runningGenerationRun(ctx, "project-a", "example/strategist"),
        other: await standaloneInFlight(ctx, "project-a", "example/other"),
      };
    });
    expect(inFlight).toBe(true);
    expect(running?.status).toBe("running");
    expect(other).toBe(false);
  });
});
