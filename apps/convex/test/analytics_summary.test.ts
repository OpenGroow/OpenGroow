import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS, WEB_ANALYTICS } from "./analytics_fixture";

// Issue #112: the aggregated read an Agent uses through the Internal MCP.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../analytics_summary.ts": () => import("../analytics_summary.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
  "../analytics_connections.ts": () => import("../analytics_connections.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../instances.ts": () => import("../instances.js"),
};

const INSTANCE_ID = "openclaw-summary";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|sum", subject: "sum-owner" };
const DAY = 24 * 3_600_000;
useTemplateRegistry([INSTANCE_ID], [fixtureTemplate("@test/social", {} as never)]);

async function seed() {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  await installAnalyticsAdapter(t, WEB_ANALYTICS);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-sum", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-2", channelName: "My TT", channelService: "tiktok", channelProfile: "me" });
  const post = (o: { target: string; type: string; kind: string; ageDays?: number; snapshots?: Array<{ adapter?: string; metrics: Record<string, number>; takenAt?: number }> }) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const publishedAt = now - (o.ageDays ?? 1) * DAY;
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@test/social", type: o.type,
        payload: { publishTargets: [o.target] }, lastArtifact: { publishable: o.kind === "video" ? { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "c" } : { kind: "image", imageUrl: "https://cdn.example.com/i.jpg", caption: "c" } }, status: "approved", createdAt: now, updatedAt: now,
      } as never);
      const publicationId = await ctx.db.insert("publications", {
        missionId, instanceId: INSTANCE_ID, target: o.target, status: "published", externalId: "p", createdAt: publishedAt, updatedAt: publishedAt,
      } as never);
      await ctx.db.insert("publicationAnalytics", {
        publicationId, postSeries: 0, instanceId: INSTANCE_ID, adapter: "postiz-analytics", publisherAdapter: "postiz", publishedAt, delays: [DAY], taken: 0,
        state: "waiting", nextAt: publishedAt + DAY, done: false, updatedAt: now,
      });
      for (const s of o.snapshots ?? []) {
        await ctx.db.insert("performanceSnapshots", {
          publicationId, postSeries: 0, instanceId: INSTANCE_ID, delayMs: DAY, takenAt: s.takenAt ?? now, metrics: s.metrics, adapter: s.adapter ?? "postiz-analytics", source: "adapter",
        });
      }
      return publicationId;
    });
  return { t, owner, post };
}

describe("analytics summary (issue #112)", () => {
  it("groups by platform, format and Mission type, sums counters and recomputes derived levels from the sums", async () => {
    const s = await seed();
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 50, likes: 5 }, takenAt: 1 }, { metrics: { views: 100, likes: 10 } }] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 900, likes: 10 } }] });
    const summary = await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID });
    const postiz = summary!.adapters.find((a) => a.adapter === "postiz-analytics")!;
    expect(postiz.groups).toHaveLength(1);
    expect(postiz.groups[0]).toMatchObject({ platform: "instagram", format: "image", missionType: "make_image", publications: 2, measured: 2, status: "data" });
    // Latest Snapshot of each post: views 100 + 900, likes 10 + 10.
    expect(postiz.groups[0].metrics.views).toBe(1000);
    expect(postiz.groups[0].metrics.likes).toBe(20);
    // 20 / 1000, not the mean of 10% and 1.11%.
    expect(postiz.groups[0].metrics.engagement).toBeCloseTo(0.02);
  });

  it("carries the direction of each metric and separates groups", async () => {
    const s = await seed();
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query("hubPackages").withIndex("by_kind_provides", (q) => q.eq("kind", "analytics").eq("provides", "postiz-analytics")).unique();
      await ctx.db.patch(row!._id, { meta: { ...POSTIZ_ANALYTICS, metrics: [...POSTIZ_ANALYTICS.metrics, { key: "position", label: "Position", type: "level", format: "number", better: "lower" }] } });
    });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 10, position: 4 } }] });
    await s.post({ target: "tiktok:me", type: "make_video", kind: "video", snapshots: [{ metrics: { views: 7 } }] });
    const [postiz] = (await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID }))!.adapters;
    expect(postiz.metrics.find((m) => m.key === "position")?.better).toBe("lower");
    expect(postiz.groups.map((g) => `${g.platform}/${g.format}/${g.missionType}`).sort()).toEqual(["instagram/image/make_image", "tiktok/video/make_video"]);
  });

  it("tells analytics unavailable from no data yet, and honours the window", async () => {
    const s = await seed();
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: [] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
    await s.post({ target: "tiktok:me", type: "make_video", kind: "video" });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 60, snapshots: [{ metrics: { views: 1 } }] });
    const summary = (await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID }))!;
    expect(summary.unavailable).toEqual([{ platform: "tiktok", format: "video", missionType: "make_video", publications: 1 }]);
    expect(summary.adapters[0].groups).toMatchObject([{ platform: "instagram", publications: 1, status: "no_data", measured: 0, metrics: {} }]);
    const wide = (await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID, days: 90 }))!;
    expect(wide.adapters[0].groups[0]).toMatchObject({ publications: 2, measured: 1 });
  });

  it("never combines two adapters' numbers", async () => {
    const s = await seed();
    await s.owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "web-analytics", url: "https://stats.example.com", apiKey: "k" });
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:me", analyticsAdapter: ["postiz-analytics", "web-analytics"] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 100 } }, { adapter: "web-analytics", metrics: { views: 5 } }] });
    const { adapters } = (await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID }))!;
    expect(adapters.map((a) => [a.adapter, a.groups[0].metrics.views])).toEqual([["postiz-analytics", 100], ["web-analytics", 5]]);
  });

  it("returns nothing to a stranger", async () => {
    const s = await seed();
    const stranger = s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" });
    expect(await stranger.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID })).toBeNull();
  });
});
