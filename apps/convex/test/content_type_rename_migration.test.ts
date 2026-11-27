import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

// ADR-091: the stored Content Planning field `kind` becomes `contentType` (`kind` is reserved for the
// creative/operational distinction of Mission types).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../migrations.ts": () => import("../migrations.js"),
};

const INSTANCE = "instance-mig";
const OWNER = "owner-mig";
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

async function migrate(t: ReturnType<typeof convexTest>, migration: Parameters<typeof runToCompletion>[2]) {
  await t.run(async (ctx) => {
    await runToCompletion(ctx, components.migrations, migration);
  });
}

const base = { ownerId: OWNER, instanceId: INSTANCE, templateId: "strategist", agentName: "strategist", sessionKey: "s", createdAt: NOW, updatedAt: NOW };
const jobRow = (type: string, config: unknown) => ({
  ownerId: OWNER, instanceId: INSTANCE, templateId: "strategist", type, state: "active", config, runtime: {},
  unit: "daily", hour: 9, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt: NOW, updatedAt: NOW, lastSummary: "ok",
});
const runBase = async (ctx: { db: any }) => ({
  ...base,
  jobId: (await ctx.db.insert("jobs", jobRow("content_planning", {}))) as Id<"jobs">,
});

describe("migrations.renamePlannedContentKind", () => {
  const seed = async (ctx: { db: any }) => {
    const planId = await ctx.db.insert("contentPlans", {
      ownerId: OWNER, instanceId: INSTANCE, runId: await ctx.db.insert("runs", { ...(await runBase(ctx)), status: "completed" } as never),
      periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "Why", status: "approved", createdAt: NOW, approvedAt: NOW,
    });
    const recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, templateId: "example/post", missionType: "make_post", name: "Example recipe", description: "d" });
    const row = { ownerId: OWNER, instanceId: INSTANCE, planId, missionType: "make_post", recipeId, publishTargets: ["social:example"], title: "Article 1", brief: "b", plannedAt: "2030-03-06", intent: "explore", rationale: "r", status: "approved", createdAt: NOW };
    const legacy = await ctx.db.insert("plannedContents", { ...row, kind: "video" });
    const current = await ctx.db.insert("plannedContents", { ...row, contentType: "image" });
    return { legacy: legacy as Id<"plannedContents">, current: current as Id<"plannedContents">, row };
  };

  it("moves kind to contentType, keeps everything else, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const ids = await t.run(seed);

    await migrate(t, internal.migrations.renamePlannedContentKind);
    await migrate(t, internal.migrations.renamePlannedContentKind);

    await t.run(async (ctx) => {
      const legacy = (await ctx.db.get(ids.legacy)) as Record<string, unknown>;
      expect(legacy).toMatchObject({ ...ids.row, contentType: "video" });
      expect(legacy).not.toHaveProperty("kind");
      const current = (await ctx.db.get(ids.current)) as Record<string, unknown>;
      expect(current).toMatchObject({ ...ids.row, contentType: "image" });
      expect(current).not.toHaveProperty("kind");
    });
  });

  it("keeps an existing contentType when both are present", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const id = await t.run(async (ctx) => {
      const { row } = await seed(ctx);
      return (await ctx.db.insert("plannedContents", { ...row, kind: "video", contentType: "carousel" } as never)) as Id<"plannedContents">;
    });
    await migrate(t, internal.migrations.renamePlannedContentKind);
    await t.run(async (ctx) => {
      const content = (await ctx.db.get(id)) as Record<string, unknown>;
      expect(content.contentType).toBe("carousel");
      expect(content).not.toHaveProperty("kind");
    });
  });
});

describe("migrations.renameContentPlanningKindOnRuns", () => {
  const pins = (targets: Array<Record<string, unknown>>) => ({ periodStart: "2030-03-05", periodEnd: "2030-03-11", targets, ignored: ["podcast: no active Agent"] });

  it("renames the pinned targets of a Run in flight and of a settled one, and leaves every other field alone", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const ids = await t.run(async (ctx) => {
      const running = await ctx.db.insert("runs", {
        ...(await runBase(ctx)), status: "running",
        contentPlanning: pins([{ kind: "video", target: 5, existing: 2, remaining: 3, publishTargets: ["social:example"] }, { kind: "image", target: 2, existing: 0, remaining: 2, publishTargets: ["blog:example"] }]),
      } as never);
      const done = await ctx.db.insert("runs", {
        ...(await runBase(ctx)), status: "completed", completedAt: NOW, contentPlanning: pins([{ kind: "article", target: 1, existing: 1, remaining: 0, publishTargets: ["blog:example"] }]),
      } as never);
      const plain = await ctx.db.insert("runs", { ...(await runBase(ctx)), status: "completed" } as never);
      const migrated = await ctx.db.insert("runs", { ...(await runBase(ctx)), status: "pending", contentPlanning: pins([{ contentType: "video", target: 1, existing: 0, remaining: 1, publishTargets: ["a"] }]) } as never);
      return { running, done, plain, migrated };
    });
    const before = await t.run(async (ctx) => ({ done: await ctx.db.get(ids.done), plain: await ctx.db.get(ids.plain) }));

    await migrate(t, internal.migrations.renameContentPlanningKindOnRuns);
    await migrate(t, internal.migrations.renameContentPlanningKindOnRuns);

    await t.run(async (ctx) => {
      const running = (await ctx.db.get(ids.running)) as any;
      expect(running.status).toBe("running");
      expect(running.contentPlanning).toEqual(pins([
        { contentType: "video", target: 5, existing: 2, remaining: 3, publishTargets: ["social:example"] },
        { contentType: "image", target: 2, existing: 0, remaining: 2, publishTargets: ["blog:example"] },
      ]));
      const done = (await ctx.db.get(ids.done)) as any;
      expect(done.contentPlanning.targets).toEqual([{ contentType: "article", target: 1, existing: 1, remaining: 0, publishTargets: ["blog:example"] }]);
      expect({ ...done, contentPlanning: undefined }).toEqual({ ...before.done, contentPlanning: undefined });
      expect(await ctx.db.get(ids.plain)).toEqual(before.plain);
      const migrated = (await ctx.db.get(ids.migrated)) as any;
      expect(migrated.contentPlanning.targets).toEqual([{ contentType: "video", target: 1, existing: 0, remaining: 1, publishTargets: ["a"] }]);
    });
  });
});

describe("migrations.renameProductionTargetsKindOnJobs", () => {
  it("renames the stored production targets of content planning Jobs only, keeps the rest of the config, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    const ids = await t.run(async (ctx) => {
      const planning = await ctx.db.insert("jobs", jobRow("content_planning", {
        planningDays: 14,
        productionTargets: [{ kind: "video", quantity: 3, publishTargets: ["social:example"] }, { contentType: "image", quantity: 2, publishTargets: ["blog:example"] }],
      }) as never);
      const empty = await ctx.db.insert("jobs", jobRow("content_planning", { planningDays: 7, productionTargets: [] }) as never);
      const other = await ctx.db.insert("jobs", jobRow("strategic_review", { kind: "weekly", productionTargets: [{ kind: "video" }] }) as never);
      return { planning, empty, other };
    });
    const before = await t.run(async (ctx) => ({ empty: await ctx.db.get(ids.empty), other: await ctx.db.get(ids.other) }));

    await migrate(t, internal.migrations.renameProductionTargetsKindOnJobs);
    await migrate(t, internal.migrations.renameProductionTargetsKindOnJobs);

    await t.run(async (ctx) => {
      const planning = (await ctx.db.get(ids.planning)) as any;
      expect(planning.config).toEqual({
        planningDays: 14,
        productionTargets: [{ quantity: 3, publishTargets: ["social:example"], contentType: "video" }, { contentType: "image", quantity: 2, publishTargets: ["blog:example"] }],
      });
      expect(planning).toMatchObject({ lastSummary: "ok", nextRunAt: NOW, state: "active" });
      expect(await ctx.db.get(ids.empty)).toEqual(before.empty);
      expect(await ctx.db.get(ids.other)).toEqual(before.other);
    });
  });
});
