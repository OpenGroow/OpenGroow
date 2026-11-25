import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// Issue #179: the dashboard reads of Content Plans (current draft with its contents, then the history).

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../content_plan_review.ts": () => import("../content_plan_review.js"),
};

const INSTANCE = "instance-cpv";
const OTHER_INSTANCE = "instance-cpv-other";
const TEMPLATE = "strategy-capable";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-cpv", subject: "owner-cpv" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-cpv", subject: "stranger-cpv" };

const mission = (type: string, extra: Record<string, unknown> = {}) => ({ type, label: type, agentsMd: `${type}.md`, ...extra });
const producer = () => {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: {
      ...base.manifest, id: "producer-cpv", jobTypes: [],
      missionTypes: [mission("make_video", { publish: { kind: "video" } }), mission("make_tiktok", { publish: { kind: "video", platforms: ["tiktok"] } })],
    },
  } as unknown as ReturnType<typeof loadFixtureTemplate>;
};

type T = ReturnType<typeof convexTest>;
let t: T;
let restoreRegistry: () => void;
let familyId: Id<"creativeFamilies">;
let recipeId: Id<"productionRecipes">;
let sourceId: Id<"sources">;

beforeEach(async () => {
  restoreRegistry = installTemplateRegistry([INSTANCE, OTHER_INSTANCE], [producer()]);
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-cpv", status: "running", createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-cpv-2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE, updatedAt: now, userId: STRANGER.subject });
    await ctx.db.insert("publishers", {
      instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", updatedAt: 1,
      targets: [{ target: "social:example", channelService: "instagram" }, { target: "blog:example" }],
    } as never);
    familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "f", name: "Reaction", description: "d" });
    recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpv", missionType: "make_video", name: "Reel recipe", description: "d", status: "active" } as never);
    sourceId = await ctx.db.insert("sources", { instanceId: INSTANCE, ownerId: OWNER.subject, templateId: "producer-cpv", sourceId: "s", label: "Article 1", family: "f", marketing: {}, status: "ready", origin: "example", capturedAt: 1, createdAt: 1, analysis: {} } as never);
  });
});
afterEach(() => restoreRegistry());

const owner = () => t.withIdentity(OWNER);
const stranger = () => t.withIdentity(STRANGER);

async function plan(fields: { status?: "draft" | "approved" | "rejected"; createdAt?: number; instanceId?: string; periodEnd?: string } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const instanceId = fields.instanceId ?? INSTANCE;
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId, templateId: "tpl", agentName: "planner", sessionKey: `s-${Math.random()}`,
      status: "running", createdAt: now, updatedAt: now,
    });
    return await ctx.db.insert("contentPlans", {
      ownerId: OWNER.subject, instanceId, runId, periodStart: "2030-03-05", periodEnd: fields.periodEnd ?? "2030-03-11",
      rationale: "## Why\n\nBecause.", status: fields.status ?? "draft", createdAt: fields.createdAt ?? now,
    });
  });
}

const content = (planId: Id<"contentPlans">, over: Record<string, unknown> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("plannedContents", {
      ownerId: OWNER.subject, instanceId: INSTANCE, planId, kind: "video", missionType: "make_video", recipeId, sourceId,
      publishTargets: ["social:example"], title: "A title", brief: "A brief", plannedAt: "2030-03-06", intent: "exploit",
      rationale: "Why", status: "proposed", createdAt: 1, ...over,
    } as never),
  );

describe("content_plan_review.current", () => {
  it("is null without a draft, and for a Project the caller does not own", async () => {
    expect(await owner().query(api.content_plan_review.current, { instanceId: INSTANCE })).toBeNull();
    await content(await plan());
    expect(await stranger().query(api.content_plan_review.current, { instanceId: INSTANCE })).toBeNull();
  });

  it("returns the draft with its contents, Recipe, Creative Family and Source resolved", async () => {
    const planId = await plan();
    await content(planId, { plannedAt: "2030-03-08", title: "Later" });
    await content(planId, { plannedAt: "2030-03-06", title: "Sooner", intent: "explore" });
    const draft = (await owner().query(api.content_plan_review.current, { instanceId: INSTANCE }))!;
    expect(draft).toMatchObject({ periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "## Why\n\nBecause.", status: "draft" });
    expect(draft).not.toHaveProperty("ownerId");
    expect(draft.contents.map((c) => c.title)).toEqual(["Sooner", "Later"]);
    expect(draft.contents[0]).toMatchObject({
      kind: "video", intent: "explore", brief: "A brief", rationale: "Why",
      recipe: { id: recipeId, name: "Reel recipe" }, creativeFamily: { id: familyId, name: "Reaction" }, source: { id: sourceId, label: "Article 1" },
    });
    expect(draft.contents[0]).not.toHaveProperty("ownerId");
    expect(draft.quantities).toEqual([{ kind: "video", count: 2 }]);
    expect(draft.distribution).toEqual({ explore: 1, exploit: 1 });
  });

  it("recomputes Publisher compatibility: a channel the capabilities do not state is flagged uncertain", async () => {
    await content(await plan());
    const draft = (await owner().query(api.content_plan_review.current, { instanceId: INSTANCE }))!;
    expect(draft.contents[0]!.publishTargets).toEqual([{ target: "social:example", uncertain: true, reason: expect.any(String), service: "instagram", adapter: "example", label: "@example" }]);
  });

  it("flags a destination removed since as unavailable rather than failing", async () => {
    await content(await plan(), { publishTargets: ["gone:example"] });
    const draft = (await owner().query(api.content_plan_review.current, { instanceId: INSTANCE }))!;
    expect(draft.contents[0]!.publishTargets).toEqual([{ target: "gone:example", uncertain: false, unavailable: true }]);
  });

  it("tolerates a Recipe, Family or Source that is gone", async () => {
    await content(await plan());
    await t.run(async (ctx) => {
      await ctx.db.delete(sourceId);
      await ctx.db.delete(recipeId);
    });
    const draft = (await owner().query(api.content_plan_review.current, { instanceId: INSTANCE }))!;
    expect(draft.contents[0]).toMatchObject({ recipe: null, creativeFamily: null, source: null });
  });
});

describe("content_plan_review.history", () => {
  it("lists approved and rejected plans, newest first, with counts, never the draft", async () => {
    const old = await plan({ status: "approved", createdAt: 10 });
    await content(old, { status: "approved" });
    await content(old, { status: "rejected" });
    await plan({ status: "rejected", createdAt: 20 });
    await plan({ status: "draft", createdAt: 30 });
    await plan({ status: "approved", createdAt: 40, instanceId: OTHER_INSTANCE });
    const history = await owner().query(api.content_plan_review.history, { instanceId: INSTANCE });
    expect(history.map((p) => [p.status, p.createdAt])).toEqual([["rejected", 20], ["approved", 10]]);
    expect(history[1]).toMatchObject({ periodStart: "2030-03-05", periodEnd: "2030-03-11", rationale: "## Why\n\nBecause.", counts: { total: 2, approved: 1, rejected: 1 } });
    expect(history[0]).not.toHaveProperty("ownerId");
    expect(await stranger().query(api.content_plan_review.history, { instanceId: INSTANCE })).toEqual([]);
  });
});

describe("content_plan_review.planDetail", () => {
  it("returns the contents of a decided plan by date, rejected ones included, with references resolved", async () => {
    const planId = await plan({ status: "approved" });
    await content(planId, { plannedAt: "2030-03-08", title: "Later", status: "approved" });
    await content(planId, { plannedAt: "2030-03-06", title: "Sooner", status: "rejected" });
    const contents = (await owner().query(api.content_plan_review.planDetail, { planId }))!;
    expect(contents.map((c) => [c.title, c.status])).toEqual([["Sooner", "rejected"], ["Later", "approved"]]);
    expect(contents[0]).toMatchObject({
      recipe: { id: recipeId, name: "Reel recipe" }, creativeFamily: { id: familyId, name: "Reaction" }, source: { id: sourceId, label: "Article 1" },
      publishTargets: [{ target: "social:example", uncertain: true, reason: expect.any(String), service: "instagram", adapter: "example", label: "@example" }],
    });
    expect(contents[0]).not.toHaveProperty("ownerId");
  });

  it("is null for a stranger", async () => {
    const planId = await plan({ status: "rejected" });
    await content(planId);
    expect(await stranger().query(api.content_plan_review.planDetail, { planId })).toBeNull();
  });

  it("is null for a plan that no longer exists", async () => {
    const planId = await plan({ status: "rejected" });
    await t.run((ctx) => ctx.db.delete(planId));
    expect(await owner().query(api.content_plan_review.planDetail, { planId })).toBeNull();
  });
});
