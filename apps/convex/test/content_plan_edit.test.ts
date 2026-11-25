import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";
import { installTemplateRegistry, loadFixtureTemplate } from "./helpers/template_registry.helpers";

// Issue #180: editing a draft Content Plan (title, brief, date, Recipe, Publish targets) and removing proposals.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../content_plan_review.ts": () => import("../content_plan_review.js"),
  "../content_plan_edit.ts": () => import("../content_plan_edit.js"),
};

const INSTANCE = "instance-cpe";
const OTHER_INSTANCE = "instance-cpe-other";
const TEMPLATE = "strategy-capable";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-cpe", subject: "owner-cpe" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-cpe", subject: "stranger-cpe" };

const mission = (type: string, extra: Record<string, unknown> = {}) => ({ type, label: type, agentsMd: `${type}.md`, ...extra });
const producer = () => {
  const base = loadFixtureTemplate(TEMPLATE);
  return {
    ...base,
    manifest: {
      ...base.manifest, id: "producer-cpe", jobTypes: [],
      missionTypes: [mission("make_video", { publish: { kind: "video" } }), mission("make_post", { publish: { kind: "image" } }), mission("make_sourced", { publish: { kind: "video" }, contextProviders: ["observation-production-source"] }), mission("make_tiktok", { publish: { kind: "video", platforms: ["tiktok"] } })],
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
    await insertInstance(ctx, { jobId: "job-cpe", status: "running", createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-cpe-2", status: "running", createdAt: now, openclawId: OTHER_INSTANCE, updatedAt: now, userId: STRANGER.subject });
    await ctx.db.insert("publishers", {
      instanceId: INSTANCE, adapter: "example", url: "https://publisher.example.com", updatedAt: 1,
      targets: [{ target: "social:example", channelService: "instagram" }, { target: "blog:example" }],
    } as never);
    await ctx.db.insert("projectAgents", { instanceId: INSTANCE, templateId: "producer-cpe", status: "active", mcpServerKeys: [], createdAt: 1, updatedAt: 1 });
    familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "f", name: "Reaction", description: "d" });
    recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_video", name: "Reel recipe", description: "d", status: "active" } as never);
    sourceId = await ctx.db.insert("sources", { instanceId: INSTANCE, ownerId: OWNER.subject, templateId: "producer-cpe", sourceId: "s", label: "Article 1", family: "f", marketing: {}, status: "ready", origin: "example", capturedAt: 1, createdAt: 1, analysis: {} } as never);
  });
});
afterEach(() => restoreRegistry());

const owner = () => t.withIdentity(OWNER);
const stranger = () => t.withIdentity(STRANGER);

async function plan(fields: { status?: "draft" | "approved" | "rejected"; periodStart?: string } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId: INSTANCE, templateId: "tpl", agentName: "planner", sessionKey: `s-${Math.random()}`,
      status: "running", createdAt: now, updatedAt: now,
      contentPlanning: {
        periodStart: "2030-03-05", periodEnd: "2030-03-11",
        targets: [{ kind: "video", target: 5, existing: 0, remaining: 5, publishTargets: ["social:example"] }], ignored: [],
      },
    } as never);
    return await ctx.db.insert("contentPlans", {
      ownerId: OWNER.subject, instanceId: INSTANCE, runId, periodStart: fields.periodStart ?? "2030-03-05", periodEnd: "2030-03-11",
      rationale: "Because.", status: fields.status ?? "draft", createdAt: now,
    });
  });
}

const content = (planId: Id<"contentPlans">, over: Record<string, unknown> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("plannedContents", {
      ownerId: OWNER.subject, instanceId: INSTANCE, planId, kind: "video", missionType: "make_video", recipeId, sourceId,
      publishTargets: ["social:example", "blog:example"], title: "A title", brief: "A brief", plannedAt: "2030-03-06", intent: "exploit",
      rationale: "Why", status: "proposed", createdAt: 1, ...over,
    } as never),
  );
const row = (id: Id<"plannedContents">) => t.run((ctx) => ctx.db.get(id));

describe("content_plan_edit.update", () => {
  it("edits the title, brief and date, and leaves the rest untouched", async () => {
    const id = await content(await plan());
    await owner().mutation(api.content_plan_edit.update, { contentId: id, title: "New title", brief: "New brief", plannedAt: "2030-03-09" });
    expect(await row(id)).toMatchObject({ title: "New title", brief: "New brief", plannedAt: "2030-03-09", recipeId, publishTargets: ["social:example", "blog:example"], intent: "exploit" });
  });

  it("refuses an empty or too long title and brief", async () => {
    const id = await content(await plan());
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, title: "  " })).rejects.toThrow(/title/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, title: "x".repeat(201) })).rejects.toThrow(/title/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, brief: "" })).rejects.toThrow(/brief/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, brief: "x".repeat(4001) })).rejects.toThrow(/brief/);
  });

  it("refuses a date outside the Planning period, malformed, or in the past", async () => {
    const id = await content(await plan());
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, plannedAt: "2030-03-12" })).rejects.toThrow(/Planning period/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, plannedAt: "2030-03-04" })).rejects.toThrow(/Planning period/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, plannedAt: "March 7" })).rejects.toThrow(/YYYY-MM-DD/);
    const pastPlan = await plan({ periodStart: "2020-01-01" });
    const pastId = await content(pastPlan, { plannedAt: "2030-03-06" });
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: pastId, plannedAt: "2020-06-01" })).rejects.toThrow(/past/);
  });

  it("changes the Recipe to another active Recipe of the same Mission type only", async () => {
    const id = await content(await plan());
    const other = await t.run(async (ctx) => ({
      same: await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_video", name: "Other", description: "d", status: "active" } as never),
      archived: await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_video", name: "Old", description: "d", status: "archived" } as never),
      otherType: await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_tiktok", name: "Tok", description: "d", status: "active" } as never),
      foreign: await ctx.db.insert("productionRecipes", { instanceId: OTHER_INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_video", name: "F", description: "d", status: "active" } as never),
    }));
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: other.otherType })).rejects.toThrow(/Mission type/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: other.archived })).rejects.toThrow(/archived/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: other.foreign })).rejects.toThrow(/Recipe of this Project/);
    expect((await row(id))!.recipeId).toBe(recipeId);
    await owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: other.same });
    expect((await row(id))!.recipeId).toBe(other.same);
    const options = await owner().query(api.content_plan_edit.recipeOptions, { contentId: id });
    expect(options.map((o) => o.name).sort()).toEqual(["Other", "Reel recipe"]);
    expect(await stranger().query(api.content_plan_edit.recipeOptions, { contentId: id })).toEqual([]);
  });

  it("applies the persistence rules to a new Recipe: a Mission type that needs a Source keeps requiring one", async () => {
    const id = await content(await plan(), { missionType: "make_sourced", sourceId: undefined });
    const sourced = await t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_sourced", name: "Sourced", description: "d", status: "active" } as never));
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: sourced })).rejects.toThrow(/needs a Source/);
    const withSource = await content(await plan(), { missionType: "make_sourced", sourceId });
    await owner().mutation(api.content_plan_edit.update, { contentId: withSource, recipeId: sourced });
    expect((await row(withSource))!.recipeId).toBe(sourced);
  });

  it("refuses a Recipe whose format has no production target in the plan", async () => {
    const id = await content(await plan(), { missionType: "make_post", kind: "image" });
    const post = await t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "producer-cpe", missionType: "make_post", name: "Post", description: "d", status: "active" } as never));
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, recipeId: post })).rejects.toThrow(/no production target/);
  });

  it("refuses to remove the Publish targets that are still available, leaving only gone channels", async () => {
    const id = await content(await plan(), { publishTargets: ["social:example", "gone:example"] });
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, publishTargets: ["gone:example"] })).rejects.toThrow(/still available/);
    expect((await row(id))!.publishTargets).toEqual(["social:example", "gone:example"]);
  });

  it("lets Publish targets shrink, never grow, and never be emptied", async () => {
    const id = await content(await plan(), { publishTargets: ["social:example", "blog:example"] });
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, publishTargets: ["social:example", "other:example"] })).rejects.toThrow(/only be removed/);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, publishTargets: [] })).rejects.toThrow(/at least one/);
    await owner().mutation(api.content_plan_edit.update, { contentId: id, publishTargets: ["blog:example"] });
    expect((await row(id))!.publishTargets).toEqual(["blog:example"]);
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: id, publishTargets: ["social:example"] })).rejects.toThrow(/only be removed/);
  });

  it("is refused outside a draft, for a removed proposal, and for another owner", async () => {
    const approved = await content(await plan({ status: "approved" }), { status: "approved" });
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: approved, title: "x" })).rejects.toThrow(/draft/);
    const draft = await plan();
    const removed = await content(draft, { status: "rejected" });
    await expect(owner().mutation(api.content_plan_edit.update, { contentId: removed, title: "x" })).rejects.toThrow(/removed/);
    const mine = await content(draft);
    await expect(stranger().mutation(api.content_plan_edit.update, { contentId: mine, title: "x" })).rejects.toThrow(/Forbidden/);
    expect((await row(mine))!.title).toBe("A title");
  });
});

describe("content_plan_edit.remove", () => {
  it("rejects the proposal, keeps it, and excludes it from the draft counts", async () => {
    const planId = await plan();
    const id = await content(planId);
    await content(planId, { intent: "explore" });
    await owner().mutation(api.content_plan_edit.remove, { contentId: id });
    expect((await row(id))!.status).toBe("rejected");
    const draft = (await owner().query(api.content_plan_review.current, { instanceId: INSTANCE }))!;
    expect(draft.contents.map((c) => c.status).sort()).toEqual(["proposed", "rejected"]);
    expect(draft.quantities).toEqual([{ kind: "video", count: 1 }]);
    expect(draft.distribution).toEqual({ explore: 1, exploit: 0 });
  });

  it("is refused outside a draft and for another owner", async () => {
    const approved = await content(await plan({ status: "approved" }), { status: "approved" });
    await expect(owner().mutation(api.content_plan_edit.remove, { contentId: approved })).rejects.toThrow(/draft/);
    const mine = await content(await plan());
    await expect(stranger().mutation(api.content_plan_edit.remove, { contentId: mine })).rejects.toThrow(/Forbidden/);
    expect((await row(mine))!.status).toBe("proposed");
  });
});
