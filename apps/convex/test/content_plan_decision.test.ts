import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// Issue #181: approving or rejecting a whole Content Plan, atomically (ADR-086).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../content_plan_decision.ts": () => import("../content_plan_decision.js"),
};

const INSTANCE = "instance-cpd";
const TEMPLATE = "producer-cpd";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-cpd", subject: "owner-cpd" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-cpd", subject: "stranger-cpd" };
const NOW = Date.UTC(2030, 2, 4, 10, 0, 0);

const mission = (type: string, extra: Record<string, unknown> = {}) => ({ type, label: type, agentsMd: `${type}.md`, ...extra });
const producer = () => {
  const base = loadFixtureTemplate("strategy-capable");
  return {
    ...base,
    manifest: { ...base.manifest, id: TEMPLATE, jobTypes: [], missionTypes: [mission("make_video", { publish: { kind: "video" } })] },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;
let recipeId: Id<"productionRecipes">;
let familyId: Id<"creativeFamilies">;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  restoreRegistry = installTemplateRegistry([INSTANCE], [producer()]);
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date(NOW).toISOString();
    await insertInstance(ctx, { jobId: "job-cpd", status: "running", createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject });
    await ctx.db.insert("publishers", {
      instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", updatedAt: 1,
      targets: [{ target: "social:example", channelService: "instagram" }],
    } as never);
    await ctx.db.insert("projectAgents", { instanceId: INSTANCE, templateId: TEMPLATE, status: "active", workspaceKey: "ws", openclawAgentName: "a", mcpServerKeys: [], createdAt: NOW, updatedAt: NOW } as never);
    familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "f", name: "F", description: "d" });
    recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: TEMPLATE, missionType: "make_video", name: "R", description: "d", status: "active" } as never);
  });
});
afterEach(() => {
  restoreRegistry();
  vi.useRealTimers();
});

const owner = () => t.withIdentity(OWNER);

async function plan(over: { remaining?: number; target?: number } = {}) {
  return await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: NOW, createdAt: NOW, updatedAt: NOW,
    });
    const target = over.target ?? 2;
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "tpl", agentName: "planner", sessionKey: "s", status: "running", createdAt: NOW, updatedAt: NOW,
      contentPlanning: {
        periodStart: "2030-03-05", periodEnd: "2030-03-11",
        targets: [{ kind: "video", target, existing: 0, remaining: over.remaining ?? target, publishTargets: ["social:example"] }], ignored: [],
      },
    } as never);
    return await ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId: INSTANCE, runId, periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "r", status: "draft", createdAt: NOW });
  });
}

const content = (planId: Id<"contentPlans">, over: Record<string, unknown> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("plannedContents", {
      ownerId: OWNER.subject, instanceId: INSTANCE, planId, kind: "video", missionType: "make_video", recipeId,
      publishTargets: ["social:example"], title: "T", brief: "B", plannedAt: "2030-03-06", intent: "exploit", rationale: "W", status: "proposed", createdAt: 1, ...over,
    } as never),
  );

const statuses = (planId: Id<"contentPlans">) =>
  t.run(async (ctx) => ({
    plan: (await ctx.db.get(planId))!.status,
    contents: (await ctx.db.query("plannedContents").collect()).filter((c) => c.planId === planId).map((c) => c.status),
  }));

describe("content_plan_decision.approve", () => {
  it("approves the plan and its retained contents, below the targets, creating no Mission", async () => {
    const planId = await plan({ target: 3 });
    await content(planId);
    await content(planId, { status: "rejected" });
    const result = await owner().mutation(api.content_plan_decision.approve, { planId });
    expect(result).toEqual({ ok: true });
    expect(await statuses(planId)).toEqual({ plan: "approved", contents: ["approved", "rejected"] });
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);
  });

  it("is refused for a stranger", async () => {
    const planId = await plan();
    await content(planId);
    await expect(t.withIdentity(STRANGER).mutation(api.content_plan_decision.approve, { planId })).rejects.toThrow(/Forbidden/);
  });

  it("is refused without a retained content", async () => {
    const planId = await plan();
    await content(planId, { status: "rejected" });
    const result = await owner().mutation(api.content_plan_decision.approve, { planId });
    expect(result).toMatchObject({ ok: false, reason: "no_content" });
    expect((await statuses(planId)).plan).toBe("draft");
  });

  it("is refused when a retained date is past", async () => {
    const planId = await plan();
    await content(planId, { plannedAt: "2030-03-03" });
    expect(await owner().mutation(api.content_plan_decision.approve, { planId })).toMatchObject({ ok: false, reason: "past_date" });
    expect((await statuses(planId)).plan).toBe("draft");
  });

  it("is refused when the Recipe was archived", async () => {
    const planId = await plan();
    await content(planId);
    await t.run((ctx) => ctx.db.patch(recipeId, { status: "archived" } as never));
    expect(await owner().mutation(api.content_plan_decision.approve, { planId })).toMatchObject({ ok: false, reason: "invalid" });
    expect((await statuses(planId)).plan).toBe("draft");
  });

  it("is refused when the retained total exceeds what remains now, counting plans approved since dispatch", async () => {
    const planId = await plan({ target: 2 });
    await content(planId);
    await content(planId);
    expect(await owner().mutation(api.content_plan_decision.approve, { planId })).toEqual({ ok: true });

    const other = await plan({ target: 2 });
    await content(other);
    await t.run((ctx) => ctx.db.patch(other, { periodStart: "2030-03-05" }));
    expect(await owner().mutation(api.content_plan_decision.approve, { planId: other })).toMatchObject({ ok: false, reason: "over_quota" });
  });

  it("cannot decide a plan twice, and two concurrent approvals leave one decision", async () => {
    const planId = await plan();
    await content(planId);
    const results = await Promise.all([
      owner().mutation(api.content_plan_decision.approve, { planId }),
      owner().mutation(api.content_plan_decision.approve, { planId }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "not_draft" });
    expect(await owner().mutation(api.content_plan_decision.reject, { planId })).toMatchObject({ ok: false, reason: "not_draft" });
  });
});

describe("content_plan_decision.reject", () => {
  it("rejects the plan and its proposed contents, then a new draft may exist", async () => {
    const planId = await plan();
    await content(planId);
    expect(await owner().mutation(api.content_plan_decision.reject, { planId })).toEqual({ ok: true });
    expect(await statuses(planId)).toEqual({ plan: "rejected", contents: ["rejected"] });
    expect((await t.run((ctx) => ctx.db.query("contentPlans").collect())).filter((p) => p.status === "draft")).toHaveLength(0);
  });
});
