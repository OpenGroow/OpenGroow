import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { insertInstance } from "./instance_fixture";

// Issue #182: the Editorial Calendar read: approved Planned Contents of every plan of the Project, by date range.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../editorial_calendar.ts": () => import("../editorial_calendar.js"),
};

const INSTANCE = "instance-cal";
const OTHER = "instance-cal-other";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|owner-cal", subject: "owner-cal" };
const STRANGER = { name: "S", email: "s@example.com", tokenIdentifier: "test|stranger-cal", subject: "stranger-cal" };

type T = ReturnType<typeof convexTest>;
let t: T;
let recipeId: Id<"productionRecipes">;

beforeEach(async () => {
  t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-cal", status: "running", createdAt: now, openclawId: INSTANCE, updatedAt: now, userId: OWNER.subject });
    await insertInstance(ctx, { jobId: "job-cal-2", status: "running", createdAt: now, openclawId: OTHER, updatedAt: now, userId: STRANGER.subject });
    const familyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE, slug: "f", name: "Reaction", description: "d" });
    recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE, creativeFamilyId: familyId, templateId: "tpl", missionType: "make_video", name: "Reel recipe", description: "d", status: "active" } as never);
  });
});
afterEach(() => undefined);

const owner = () => t.withIdentity(OWNER);

async function plan(periodStart: string, periodEnd: string, instanceId = INSTANCE) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ownerId: OWNER.subject, instanceId, templateId: "tpl", type: "custom", state: "active", config: {}, runtime: {},
      unit: "daily", hour: 6, minute: 0, timezone: "UTC", nextRunAt: now, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("runs", {
      jobId, ownerId: OWNER.subject, instanceId, templateId: "tpl", agentName: "planner", sessionKey: `s-${Math.random()}`,
      status: "running", createdAt: now, updatedAt: now,
    });
    return await ctx.db.insert("contentPlans", { ownerId: OWNER.subject, instanceId, runId, periodStart, periodEnd, rationale: "r", status: "approved", createdAt: now });
  });
}

const content = (planId: Id<"contentPlans">, over: Record<string, unknown> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("plannedContents", {
      ownerId: OWNER.subject, instanceId: INSTANCE, planId, kind: "video", missionType: "make_video", recipeId,
      publishTargets: ["social:example"], title: "A title", brief: "A brief", plannedAt: "2030-03-06", intent: "exploit",
      rationale: "Why", status: "approved", createdAt: 1, ...over,
    } as never),
  );

const range = { instanceId: INSTANCE, from: "2030-03-01", to: "2030-03-31" };

describe("editorial_calendar.range", () => {
  it("returns only approved contents, from several plans, ordered by date, with their plan", async () => {
    const a = await plan("2030-03-04", "2030-03-10");
    const b = await plan("2030-03-11", "2030-03-17");
    await content(a, { title: "Later", plannedAt: "2030-03-12" });
    await content(b, { title: "Sooner", plannedAt: "2030-03-05" });
    await content(a, { title: "Proposed", status: "proposed" });
    await content(a, { title: "Rejected", status: "rejected" });
    const days = await owner().query(api.editorial_calendar.range, range);
    expect(days.truncated).toBe(false);
    expect(days.items.map((c) => c.title)).toEqual(["Sooner", "Later"]);
    expect(days.items[0]).toMatchObject({ planId: b, plan: { periodStart: "2030-03-11", periodEnd: "2030-03-17" }, kind: "video", publishTargets: ["social:example"], brief: "A brief" });
    expect(days.items[0]).not.toHaveProperty("ownerId");
  });

  it("bounds the range inclusively", async () => {
    const a = await plan("2030-03-04", "2030-03-10");
    await content(a, { title: "Before", plannedAt: "2030-02-28" });
    await content(a, { title: "First", plannedAt: "2030-03-01" });
    await content(a, { title: "Last", plannedAt: "2030-03-31" });
    await content(a, { title: "After", plannedAt: "2030-04-01" });
    expect((await owner().query(api.editorial_calendar.range, range)).items.map((c) => c.title)).toEqual(["First", "Last"]);
  });

  it("is empty for a stranger and does not leak other Projects", async () => {
    const a = await plan("2030-03-04", "2030-03-10");
    await content(a);
    expect(await t.withIdentity(STRANGER).query(api.editorial_calendar.range, range)).toEqual({ items: [], truncated: false });
    expect(await owner().query(api.editorial_calendar.range, { ...range, instanceId: OTHER })).toEqual({ items: [], truncated: false });
  });

  it("says when the range holds more contents than it returns", async () => {
    const a = await plan("2030-03-04", "2030-03-10");
    await t.run(async (ctx) => {
      for (let i = 0; i < 501; i++) {
        await ctx.db.insert("plannedContents", {
          ownerId: OWNER.subject, instanceId: INSTANCE, planId: a, kind: "video", missionType: "make_video", recipeId,
          publishTargets: ["social:example"], title: `T${i}`, brief: "B", plannedAt: "2030-03-06", intent: "exploit", rationale: "W", status: "approved", createdAt: 1,
        } as never);
      }
    });
    const result = await owner().query(api.editorial_calendar.range, range);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(500);
  });
});
