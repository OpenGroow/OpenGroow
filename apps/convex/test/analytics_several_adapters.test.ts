import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS, WEB_ANALYTICS, type AnalyticsAdapterData } from "./analytics_fixture";

// ADR-079, issue #104: a channel is linked to a list of Analytics Adapters, a Snapshot records the
// adapter that took it, and the Analytics page asks for one adapter at a time (Seam 1).

vi.mock("../analytics/load_node.js", () => ({
  loadAnalyticsAdapter: async (_ctx: unknown, id: string) => ({
    id,
    name: id,
    contractVersion: 2,
    needs: id === "web-analytics" ? "url" : "externalId",
    earliestDelayMs: 0,
    read: async () => ({ ok: true, reading: { status: "taken", metrics: id === "web-analytics" ? { clicks: 5 } : { views: 100 } } }),
  }),
}));
vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../analytics_node.ts": () => import("../analytics_node.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
  "../analytics_connections.ts": () => import("../analytics_connections.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_notifications.ts": () => import("../publication_notifications.js"),
  "../missions.ts": () => import("../missions.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
  "../instances.ts": () => import("../instances.js"),
};

const INSTANCE_ID = "openclaw-several";
const TARGET = "instagram:me";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|sev", subject: "sev-owner" };
const DAY = 24 * 3_600_000;
useTemplateRegistry(
  [INSTANCE_ID],
  [fixtureTemplate("@test/social", { missionTypes: [{ type: "make_image", label: "Image", payload: "{}", agentsMd: "a.md", publish: { kind: "image" }, analytics: { collect: [1] } }] } as never)],
);

const views = { key: "views", label: "Views", type: "counter" as const, format: "number" as const };
const clicks = { key: "clicks", label: "Clicks", type: "counter" as const, format: "number" as const };
const POSTIZ: AnalyticsAdapterData = { ...POSTIZ_ANALYTICS, metrics: [views], primary: "views" };
const WEB: AnalyticsAdapterData = { ...WEB_ANALYTICS, earliestDelayMs: 0, metrics: [clicks], primary: "clicks" };

async function seed(adapters: AnalyticsAdapterData[] = [POSTIZ, WEB]) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  for (const adapter of adapters) await installAnalyticsAdapter(t, adapter);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-sev", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
  await owner.mutation(api.analytics_connections.save, { instanceId: INSTANCE_ID, adapter: "web-analytics", url: "https://stats.example.com", apiKey: "k" });
  const link = (analyticsAdapter: string | string[] | null) =>
    owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: TARGET, analyticsAdapter });
  const publish = async () => {
    const publicationId = await t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: "@test/social",
        type: "make_image",
        payload: { publishTargets: [TARGET] },
        status: "approved",
        createdAt: now,
        updatedAt: now,
      } as never);
      return await ctx.db.insert("publications", {
        missionId,
        instanceId: INSTANCE_ID,
        target: TARGET,
        status: "pending",
        externalId: "p1",
        externalUrl: "https://example.com/p1",
        attemptContext: { adapter: "postiz", url: "https://postiz.example.com", channelId: "ch-1", publishable: { kind: "image" } },
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.mutation(internal.publications.finish, { publicationId, status: "published" });
    return publicationId;
  };
  const tick = async () => {
    vi.advanceTimersByTime(DAY);
    await t.action(internal.analytics_node.collectDue, {});
  };
  return { t, owner, link, publish, tick };
}

describe("several Analytics Adapters on one channel (ADR-079)", () => {
  it("keeps separate Snapshots for each adapter a channel is linked to", async () => {
    vi.useFakeTimers();
    try {
      const s = await seed();
      await s.link(["postiz-analytics", "web-analytics"]);
      const publicationId = await s.publish();
      await s.tick();
      const view = await s.owner.query(api.analytics.forPublication, { publicationId });
      expect(view?.snapshots).toHaveLength(2);
      expect(view?.snapshots.map((x) => [x.adapter, x.metrics])).toEqual(
        expect.arrayContaining([
          ["postiz-analytics", { views: 100 }],
          ["web-analytics", { clicks: 5 }],
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists, for the chosen adapter, only the Publications of channels linked to it, with its own Snapshots", async () => {
    vi.useFakeTimers();
    try {
      const s = await seed();
      await s.link(["postiz-analytics", "web-analytics"]);
      await s.publish();
      await s.tick();
      const forWeb = await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "web-analytics" });
      expect(forWeb).toHaveLength(1);
      expect(forWeb[0].snapshots.map((x) => x.metrics)).toEqual([{ clicks: 5 }]);
      expect(forWeb[0].primaryMetric).toBe("clicks");
      const forPostiz = await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "postiz-analytics" });
      expect(forPostiz[0].snapshots.map((x) => x.metrics)).toEqual([{ views: 100 }]);
      // Linked to one only: the other adapter's page does not list the post.
      await s.link("web-analytics");
      expect(await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "postiz-analytics" })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the adapters the Project's channels are linked to, the first activated first, with their declaration", async () => {
    const s = await seed();
    expect(await s.owner.query(api.analytics.adaptersForProject, { instanceId: INSTANCE_ID })).toEqual([
      { adapter: "postiz-analytics", name: "Postiz analytics", metrics: [views], primary: "views" },
    ]);
    await s.link(["postiz-analytics", "web-analytics"]);
    const adapters = await s.owner.query(api.analytics.adaptersForProject, { instanceId: INSTANCE_ID });
    expect(adapters.map((a) => a.adapter)).toEqual(["postiz-analytics", "web-analytics"]);
    const stranger = s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" });
    expect(await stranger.query(api.analytics.adaptersForProject, { instanceId: INSTANCE_ID })).toEqual([]);
  });

  it("shows every link on the channel and keeps a single-string link working", async () => {
    const s = await seed();
    await s.link(["postiz-analytics", "web-analytics"]);
    const analytics = async () => {
      const [publisher] = await s.owner.query(api.publishers.list, { instanceId: INSTANCE_ID });
      const channel = publisher.targets.find((x) => x.target === TARGET);
      if (!channel?.mapped) throw new Error("No channel");
      return channel.analytics;
    };
    expect(await analytics()).toMatchObject({ linked: true, adapterId: "postiz-analytics", adapters: [{ adapterId: "postiz-analytics" }, { adapterId: "web-analytics" }] });
    await s.link("web-analytics");
    expect(await analytics()).toMatchObject({ adapterId: "web-analytics", adapters: [{ adapterId: "web-analytics" }] });
  });

  it("keeps working for a reading made before several links: its row and Snapshots belong to the channel's first link", async () => {
    const s = await seed();
    const publicationId = await s.publish();
    await s.t.run(async (ctx) => {
      // What a Publication measured before this change left: no adapter on the row nor on the Snapshot.
      for (const row of await ctx.db.query("publicationAnalytics").collect()) await ctx.db.patch(row._id, { adapter: undefined });
      const row = await ctx.db.query("publicationAnalytics").first();
      await ctx.db.insert("performanceSnapshots", { publicationId, postSeries: 0, instanceId: INSTANCE_ID, delayMs: DAY, takenAt: Date.now(), metrics: { views: 7 }, source: "adapter" });
      expect(row?.adapter).toBeUndefined();
    });
    const [post] = await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID });
    expect(post.snapshots.map((x) => x.metrics)).toEqual([{ views: 7 }]);
    await s.link(["postiz-analytics", "web-analytics"]);
    expect(await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "web-analytics" })).toEqual([]);
  });

  it("gives a Snapshot without adapter to the channel's first link only", async () => {
    vi.useFakeTimers();
    try {
      const s = await seed();
      await s.link(["postiz-analytics", "web-analytics"]);
      const publicationId = await s.publish();
      await s.tick();
      await s.t.run(async (ctx) => {
        await ctx.db.insert("performanceSnapshots", { publicationId, postSeries: 0, instanceId: INSTANCE_ID, delayMs: DAY, takenAt: Date.now(), metrics: { views: 7 }, source: "adapter" });
      });
      const forWeb = await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "web-analytics" });
      expect(forWeb[0].snapshots.map((x) => x.metrics)).toEqual([{ clicks: 5 }]);
      const forPostiz = await s.owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, adapter: "postiz-analytics" });
      expect(forPostiz[0].snapshots.map((x) => x.metrics)).toEqual(expect.arrayContaining([{ views: 100 }, { views: 7 }]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a list holding an adapter that is not installed", async () => {
    const s = await seed();
    await expect(s.link(["postiz-analytics", "ghost"])).rejects.toThrow(/not installed/);
  });
});
