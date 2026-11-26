import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import { summarizeProject, type AnalyticsSummary } from "../analytics_summary";
import { SCAN_LIMIT } from "../analytics_window";
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

/** The default grouping: `groupBy` absent returns the platform/format/type summary. */
const plain = (owner: { query: (...args: never[]) => unknown }, args: Record<string, unknown>) =>
  (owner.query as (fn: unknown, a: unknown) => Promise<AnalyticsSummary | null>)(api.analytics_summary.summaryForProject, args);

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
  const post = (o: { target: string; type: string; kind: string; ageDays?: number; recipe?: { id: unknown; name?: string; version?: number }; externalUrl?: string; snapshots?: Array<{ adapter?: string; metrics: Record<string, number>; takenAt?: number }> }) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const publishedAt = now - (o.ageDays ?? 1) * DAY;
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@test/social", type: o.type,
        ...(o.recipe ? { recipeSnapshot: { recipeId: o.recipe.id, recipeName: o.recipe.name ?? "R", version: o.recipe.version ?? 1, instructions: "i", constraints: [] } } : {}),
        payload: { publishTargets: [o.target] }, lastArtifact: { publishable: o.kind === "video" ? { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "c" } : { kind: "image", imageUrl: "https://cdn.example.com/i.jpg", caption: "c" } }, status: "approved", createdAt: now, updatedAt: now,
      } as never);
      const publicationId = await ctx.db.insert("publications", {
        missionId, instanceId: INSTANCE_ID, target: o.target, status: "published", externalId: "p", ...(o.externalUrl ? { externalUrl: o.externalUrl } : {}), createdAt: publishedAt, updatedAt: publishedAt,
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
  const recipe = (name: string, status: "active" | "archived" = "active") =>
    t.run((ctx) => ctx.db.insert("productionRecipes", { instanceId: INSTANCE_ID, templateId: "@test/social", missionType: "make_image", name, description: "d", status }));
  return { t, owner, post, recipe };
}

describe("analytics summary (issue #112)", () => {
  it("groups by platform, format and Mission type, sums counters and recomputes derived levels from the sums", async () => {
    const s = await seed();
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 50, likes: 5 }, takenAt: 1 }, { metrics: { views: 100, likes: 10 } }] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 900, likes: 10 } }] });
    const summary = await plain(s.owner, { instanceId: INSTANCE_ID });
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
    const [postiz] = (await plain(s.owner, { instanceId: INSTANCE_ID }))!.adapters;
    expect(postiz.metrics.find((m) => m.key === "position")?.better).toBe("lower");
    expect(postiz.groups.map((g) => `${g.platform}/${g.format}/${g.missionType}`).sort()).toEqual(["instagram/image/make_image", "tiktok/video/make_video"]);
  });

  it("tells analytics unavailable from no data yet, and honours the window", async () => {
    const s = await seed();
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: [] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
    await s.post({ target: "tiktok:me", type: "make_video", kind: "video" });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 60, snapshots: [{ metrics: { views: 1 } }] });
    const summary = (await plain(s.owner, { instanceId: INSTANCE_ID }))!;
    expect(summary.unavailable).toEqual([{ platform: "tiktok", format: "video", missionType: "make_video", publications: 1 }]);
    expect(summary.adapters[0].groups).toMatchObject([{ platform: "instagram", publications: 1, status: "no_data", measured: 0, metrics: {} }]);
    const wide = (await plain(s.owner, { instanceId: INSTANCE_ID, days: 90 }))!;
    expect(wide.adapters[0].groups[0]).toMatchObject({ publications: 2, measured: 1 });
  });

  it("never combines two adapters' numbers", async () => {
    const s = await seed();
    await s.owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "web-analytics", url: "https://stats.example.com", apiKey: "k" });
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:me", analyticsAdapter: ["postiz-analytics", "web-analytics"] });
    await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 100 } }, { adapter: "web-analytics", metrics: { views: 5 } }] });
    const { adapters } = (await plain(s.owner, { instanceId: INSTANCE_ID }))!;
    expect(adapters.map((a) => [a.adapter, a.groups[0].metrics.views])).toEqual([["postiz-analytics", 100], ["web-analytics", 5]]);
  });

  it("returns nothing to a stranger", async () => {
    const s = await seed();
    const stranger = s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" });
    expect(await plain(stranger, { instanceId: INSTANCE_ID })).toBeNull();
  });

  describe("bounded read (issue #153)", () => {
    const window = () => ({ from: Date.now() - 30 * DAY, to: Date.now() });

    it("caps the scan at 2,000 Publications", () => {
      expect(SCAN_LIMIT).toBe(2000);
    });

    it("reports a complete read without any partial marker", async () => {
      const s = await seed();
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 1 } }] });
      const summary = await s.t.run((ctx) => summarizeProject(ctx, INSTANCE_ID, window(), { scanLimit: 3 }));
      expect(summary.scanLimited).toBe(false);
      expect(summary.partial).toBe(false);
      expect(summary.oldestScannedCreatedAt).toBeUndefined();
    });

    it("reads the newest-created Publications only and flags the limited read", async () => {
      const s = await seed();
      const ids: Awaited<ReturnType<typeof s.post>>[] = [];
      for (let i = 0; i < 4; i++) ids.push(await s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ metrics: { views: 10 } }] }));
      const summary = await s.t.run((ctx) => summarizeProject(ctx, INSTANCE_ID, window(), { scanLimit: 3 }));
      expect(summary.scanLimited).toBe(true);
      expect(summary.partial).toBe(true);
      // Only the 3 newest are read: the 4th is never loaded.
      expect(summary.adapters[0].groups[0].publications).toBe(3);
      const oldestRead = await s.t.run(async (ctx) => (await ctx.db.get(ids[1]))!._creationTime);
      expect(summary.oldestScannedCreatedAt).toBe(oldestRead);
    });

    it("counts Publications without a Recipe Snapshot as unattributed", async () => {
      const s = await seed();
      const withRecipe = await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
      await s.post({ target: "tiktok:me", type: "make_video", kind: "video" });
      await s.t.run(async (ctx) => {
        const publication = (await ctx.db.get(withRecipe))!;
        const recipeId = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE_ID, templateId: "@test/social", missionType: "make_image", name: "R", description: "d", status: "active" });
        await ctx.db.patch(publication.missionId, { recipeSnapshot: { recipeId, recipeName: "R", version: 1, instructions: "i", constraints: [] } });
      });
      const summary = (await plain(s.owner, { instanceId: INSTANCE_ID }))!;
      expect(summary.unattributed).toBe(2);
    });
  });

  describe("period and platform filter (issue #154)", () => {
    const q = (s: Awaited<ReturnType<typeof seed>>, args: Record<string, unknown>) => plain(s.owner, { instanceId: INSTANCE_ID, ...args } as never);

    it("selects Publications by a number of days, then by a custom range", async () => {
      const s = await seed();
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 3 });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 20 });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 60 });
      expect((await q(s, { days: 7 }))!.adapters[0].groups[0].publications).toBe(1);
      expect((await q(s, { days: 90 }))!.adapters[0].groups[0].publications).toBe(3);
      const now = Date.now();
      const range = (await q(s, { from: now - 30 * DAY, to: now - 10 * DAY }))!;
      expect(range.adapters[0].groups[0].publications).toBe(1);
      expect(range.from).toBe(now - 30 * DAY);
      expect(range.to).toBe(now - 10 * DAY);
    });

    it("refuses both forms together, a range over 365 days and unusable values", async () => {
      const s = await seed();
      const now = Date.now();
      await expect(q(s, { days: 7, from: now - DAY, to: now })).rejects.toThrow(/either/i);
      await expect(q(s, { from: now - 366 * DAY, to: now })).rejects.toThrow(/365/);
      await expect(q(s, { from: now, to: now - DAY })).rejects.toThrow(/before/i);
      await expect(q(s, { from: now - DAY })).rejects.toThrow(/both/i);
    });

    it("clamps the existing days argument as it always did, instead of refusing it", async () => {
      const s = await seed();
      const now = Date.now();
      const spanDays = async (days: number) => {
        const r = (await q(s, { days }))!;
        return Math.round((r.to - r.from) / DAY);
      };
      expect(await spanDays(366)).toBe(365);
      expect(await spanDays(1.5)).toBe(1);
      expect(await spanDays(0)).toBe(30);
      expect(await spanDays(-3)).toBe(30);
      expect(Math.abs((await q(s, { days: 0 }))!.to - now)).toBeLessThan(60_000);
    });

    it("narrows every grouping with the platform filter", async () => {
      const s = await seed();
      await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
      await s.post({ target: "tiktok:me", type: "make_video", kind: "video" });
      const unfiltered = (await q(s, {}))!;
      expect(unfiltered.adapters[0].groups).toHaveLength(2);
      const ig = (await q(s, { platform: "instagram" }))!;
      expect(ig.adapters[0].groups).toMatchObject([{ platform: "instagram" }]);
      await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: [] });
      expect((await q(s, { platform: "instagram" }))!.unavailable).toEqual([]);
      expect((await q(s, { platform: "tiktok" }))!.unavailable).toHaveLength(1);
      expect((await q(s, { platform: "tiktok" }))!.adapters).toEqual([]);
    });
  });

  describe("grouped by Production Recipe (issue #155)", () => {
    const q = (s: Awaited<ReturnType<typeof seed>>, args: Record<string, unknown> = {}) =>
      s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID, groupBy: "recipe", ...args } as never) as Promise<any>;

    it("keeps the default output when groupBy is absent", async () => {
      const s = await seed();
      await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
      const summary = (await plain(s.owner, { instanceId: INSTANCE_ID }))!;
      expect(summary).not.toHaveProperty("recipes");
      expect(summary.adapters[0].groups).toHaveLength(1);
    });

    it("reads each recipe through its Mission's snapshot, adapter by adapter with platforms inside, with per-metric statistics", async () => {
      const s = await seed();
      const a = await s.recipe("A");
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a, version: 1 }, ageDays: 2, snapshots: [{ metrics: { views: 100, likes: 10 } }] });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a, version: 2 }, ageDays: 4, snapshots: [{ metrics: { views: 300, likes: 90 } }] });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a, version: 2 }, ageDays: 5, snapshots: [{ metrics: { views: 50 } }] });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a, version: 2 }, ageDays: 6 });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", ageDays: 1, snapshots: [{ metrics: { views: 9999 } }] });
      const res = await q(s);
      expect(res.groupBy).toBe("recipe");
      expect(res.unattributed).toBe(1);
      expect(res.recipes).toHaveLength(1);
      const [r] = res.recipes;
      expect(r).toMatchObject({ recipeId: a, recipeName: "R", archived: false, publications: 4 });
      expect(r.versions).toEqual([
        expect.objectContaining({ version: 1, publications: 1 }),
        expect.objectContaining({ version: 2, publications: 3 }),
      ]);
      expect(r.lastPublishedAt).toBeGreaterThan(Date.now() - 3 * DAY);
      expect(r.publicationAge.newestMs).toBeGreaterThanOrEqual(2 * DAY);
      expect(r.publicationAge.oldestMs).toBeGreaterThanOrEqual(6 * DAY);
      expect(r.adapters).toHaveLength(1);
      const [ad] = r.adapters;
      expect(ad).toMatchObject({ adapter: "postiz-analytics", publications: 4, measured: 3 });
      expect(ad.freshness.newestReadingAt).toBeGreaterThanOrEqual(ad.freshness.oldestReadingAt);
      expect(ad.platforms).toHaveLength(1);
      const p = ad.platforms[0];
      expect(p).toMatchObject({ platform: "instagram", publications: 4, measured: 3 });
      expect(p.metrics.views).toEqual({ observations: 3, sum: 450, mean: 150, median: 100 });
      // Two Publications report likes: 10 and 90.
      expect(p.metrics.likes).toEqual({ observations: 2, sum: 100, mean: 50, median: 50 });
      // Absent, not zero.
      expect(p.metrics).not.toHaveProperty("comments");
      expect(p.metrics).not.toHaveProperty("reach");
      // Recomputed from the sums (100 / 400), distinct from the mean of per-Publication ratios (10% and 30%).
      expect(p.metrics.engagement).toEqual({ observations: 2, recomputed: 0.25, meanOfRatios: 0.2, medianOfRatios: 0.2 });
      expect(ad).not.toHaveProperty("metrics.views");
    });

    it("does not count an empty reading as measured", async () => {
      const s = await seed();
      const a = await s.recipe("A");
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, snapshots: [{ metrics: {} }, { metrics: { unknown: 3 } }] });
      const [r] = (await q(s)).recipes;
      expect(r.adapters[0]).toMatchObject({ publications: 1, measured: 0 });
      expect(r.adapters[0].platforms[0].metrics).toEqual({});
    });

    it("counts a Publication once per adapter, never totalling adapters", async () => {
      const s = await seed();
      const a = await s.recipe("A");
      await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:me", analyticsAdapter: ["postiz-analytics", "web-analytics"] });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, snapshots: [{ metrics: { views: 10 } }, { adapter: "web-analytics", metrics: { views: 500 } }] });
      const [r] = (await q(s)).recipes;
      expect(r.publications).toBe(1);
      const views = Object.fromEntries(r.adapters.map((x: any) => [x.adapter, x.platforms[0].metrics.views.sum]));
      expect(views).toEqual({ "postiz-analytics": 10, "web-analytics": 500 });
    });

    describe("a measurement key shared by several Publications (issue #157)", () => {
      const PAGE = "https://example.com/article-1";
      const seedWeb = async () => {
        const s = await seed();
        await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:me", analyticsAdapter: "web-analytics" });
        return s;
      };
      const web = (r: any) => r.adapters.find((x: any) => x.adapter === "web-analytics");

      it("counts the metrics of a page once within a recipe, however many Publications point at it", async () => {
        const s = await seedWeb();
        const a = await s.recipe("A");
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: PAGE, ageDays: 3, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: `${PAGE}/?utm_source=x`, ageDays: 2, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: "https://example.com/article-2", ageDays: 2, snapshots: [{ adapter: "web-analytics", metrics: { views: 40 } }] });
        const [r] = (await q(s)).recipes;
        expect(r.publications).toBe(3);
        const ad = web(r);
        expect(ad).toMatchObject({ publications: 3, measured: 2, sharedMeasurements: 1 });
        expect(ad.platforms[0].metrics.views).toEqual({ observations: 2, sum: 140, mean: 70, median: 70 });
      });

      it("credits a page shared by two recipes to neither, and says so", async () => {
        const s = await seedWeb();
        const a = await s.recipe("A");
        const b = await s.recipe("B");
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: b }, externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        const res = await q(s);
        expect(res.recipes).toHaveLength(2);
        for (const r of res.recipes) {
          expect(r.publications).toBe(1);
          expect(web(r)).toMatchObject({ publications: 1, measured: 0, ambiguous: 1 });
          expect(web(r).platforms[0].metrics).toEqual({});
        }
      });

      it("treats a page shared with an unattributed Publication as ambiguous too", async () => {
        const s = await seedWeb();
        const a = await s.recipe("A");
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        const [r] = (await q(s)).recipes;
        expect(web(r)).toMatchObject({ measured: 0, ambiguous: 1 });
      });

      it("reads a page shared by Publications of one default group once, and credits none of a page split across groups", async () => {
        const s = await seedWeb();
        const one = async (extra: Record<string, unknown>) =>
          s.post({ target: "instagram:me", type: "make_image", kind: "image", snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }], ...extra } as never);
        await one({ externalUrl: PAGE, ageDays: 3 });
        await one({ externalUrl: `${PAGE}/?utm_source=x`, ageDays: 2 });
        const grouped = (await plain(s.owner as never, { instanceId: INSTANCE_ID }))!;
        const g = grouped.adapters.find((x) => x.adapter === "web-analytics")!.groups[0];
        expect(g).toMatchObject({ publications: 2, measured: 1, sharedMeasurements: 1, metrics: { views: 100 } });
        // The same page published as another Mission type lands in a second group: ambiguous in both.
        await s.post({ target: "instagram:me", type: "make_video", kind: "video", externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 100 } }] });
        const split = (await plain(s.owner as never, { instanceId: INSTANCE_ID }))!;
        for (const group of split.adapters.find((x) => x.adapter === "web-analytics")!.groups) {
          expect(group).toMatchObject({ measured: 0, status: "no_data" });
          expect(group.ambiguous).toBeGreaterThan(0);
        }
      });

      it("does not mix keys of different adapters or leave a clean key flagged", async () => {
        const s = await seedWeb();
        const a = await s.recipe("A");
        await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a }, externalUrl: PAGE, snapshots: [{ adapter: "web-analytics", metrics: { views: 7 } }] });
        const [r] = (await q(s)).recipes;
        expect(web(r)).toMatchObject({ measured: 1 });
        expect(web(r)).not.toHaveProperty("ambiguous");
        expect(web(r)).not.toHaveProperty("sharedMeasurements");
      });
    });

    it("lists a Publication with no linked adapter apart, and creates groups only for recipes with Publications in the period", async () => {
      const s = await seed();
      const a = await s.recipe("A");
      const b = await s.recipe("B");
      await s.recipe("Never used");
      await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: [] });
      await s.post({ target: "tiktok:me", type: "make_video", kind: "video", recipe: { id: a } });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: b }, ageDays: 100 });
      const res = await q(s, { days: 30 });
      expect(res.recipes).toHaveLength(1);
      expect(res.recipes[0]).toMatchObject({ recipeId: a, publications: 1, adapters: [], unavailable: [{ platform: "tiktok", publications: 1 }] });
    });

    it("keeps the historical identity of an edited or archived recipe", async () => {
      const s = await seed();
      const a = await s.recipe("Old name");
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a, name: "Old name", version: 1 } });
      await s.t.run((ctx) => ctx.db.patch(a, { name: "Renamed", status: "archived" }));
      const [r] = (await q(s)).recipes;
      expect(r).toMatchObject({ recipeId: a, recipeName: "Old name", archived: true });
      expect(r.versions[0].version).toBe(1);
    });

    it("filters by recipe, and another Project's recipe id returns nothing", async () => {
      const s = await seed();
      const a = await s.recipe("A");
      const b = await s.recipe("B");
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: a } });
      await s.post({ target: "instagram:me", type: "make_image", kind: "image", recipe: { id: b } });
      expect((await q(s, { recipeId: a })).recipes.map((r: any) => r.recipeId)).toEqual([a]);
      const foreign = await s.t.run(async (ctx) => {
        return ctx.db.insert("productionRecipes", { instanceId: "other", templateId: "@test/social", missionType: "make_image", name: "Z", description: "d", status: "active" });
      });
      expect((await q(s, { recipeId: foreign })).recipes).toEqual([]);
      expect((await q(s, { recipeId: "not-an-id" })).recipes).toEqual([]);
    });
  });

  describe("no longer grouped by Creative Family (ADR-088)", () => {
    it("refuses groupBy family and a familyId filter", async () => {
      const s = await seed();
      await expect(s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID, groupBy: "family" } as never)).rejects.toThrow();
      await expect(s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID, familyId: "x" } as never)).rejects.toThrow();
    });

    it("counts a Publication without a Recipe Snapshot as unattributed in the recipe grouping", async () => {
      const s = await seed();
      await s.post({ target: "instagram:me", type: "make_image", kind: "image" });
      const res = (await s.owner.query(api.analytics_summary.summaryForProject, { instanceId: INSTANCE_ID, groupBy: "recipe" })) as any;
      expect(res.unattributed).toBe(1);
    });
  });
});
