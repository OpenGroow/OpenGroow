import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS, WEB_ANALYTICS, type AnalyticsAdapterData } from "./analytics_fixture";

// ADR-078, issue #92: a Publish target is linked to at most one Analytics Adapter, by default
// the Publisher's own. Driven through the public Convex functions (Seam 1).

const loaded = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../analytics/load_node.js", () => ({
  loadAnalyticsAdapter: async (_ctx: unknown, id: string) => {
    loaded.ids.push(id);
    // Reports only long after publication: the reading is postponed, never settled.
    return { id, name: id, contractVersion: 1, needs: "url", earliestDelayMs: 100 * 24 * 3_600_000, read: async () => ({ ok: false, error: "unused" }) };
  },
}));
vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../analytics_node.ts": () => import("../analytics_node.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
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

const INSTANCE_ID = "openclaw-link";
const MEASURED = fixtureTemplate("@test/social", {
  missionTypes: [
    { type: "make_image", label: "Image", payload: "{}", agentsMd: "a.md", publish: { kind: "image" }, analytics: { primaryMetric: "views" } },
    { type: "make_short", label: "Short", payload: "{}", agentsMd: "b.md", publish: { kind: "image" }, analytics: { primaryMetric: "views", collect: [2] } },
    { type: "make_plain", label: "Plain", payload: "{}", agentsMd: "c.md", publish: { kind: "image" } },
  ],
} as never);
useTemplateRegistry([INSTANCE_ID], [MEASURED]);

const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|link", subject: "link-owner" };
const TARGET = "instagram:love_youmake";

async function seed(opts: { adapters?: AnalyticsAdapterData[] } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  for (const adapter of opts.adapters ?? [POSTIZ_ANALYTICS, WEB_ANALYTICS]) await installAnalyticsAdapter(t, adapter);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, {
    adapter: "postiz",
    instanceId: INSTANCE_ID,
    channelId: "ch-1",
    channelName: "My IG",
    channelService: "instagram",
    channelProfile: "love_youmake",
  });
  const analytics = async () => {
    const [publisher] = await owner.query(api.publishers.list, { instanceId: INSTANCE_ID });
    const channel = publisher.targets.find((x) => x.target === TARGET);
    if (!channel?.mapped) throw new Error("No channel");
    return channel.analytics;
  };
  const link = (analyticsAdapter: string | null) =>
    owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: TARGET, analyticsAdapter });
  return { t, owner, analytics, link };
}

describe("Analytics link of a Publish target (ADR-078)", () => {
  it("links a Postiz channel to Postiz analytics by default", async () => {
    const s = await seed();
    expect(await s.analytics()).toMatchObject({ linked: true, adapterId: "postiz-analytics", name: "Postiz analytics", isDefault: true });
  });

  it("offers only the adapters that can measure this channel", async () => {
    const s = await seed({ adapters: [POSTIZ_ANALYTICS, WEB_ANALYTICS, { id: "other-analytics", name: "Other", needs: "externalId", publisher: "other", earliestDelayMs: 0 }] });
    const { options } = await s.analytics();
    expect(options.map((o) => o.id)).toEqual(["postiz-analytics", "web-analytics"]);
  });

  it("reads 'analytics unavailable' when the Publisher brings no adapter", async () => {
    const s = await seed({ adapters: [WEB_ANALYTICS] });
    expect(await s.analytics()).toMatchObject({ linked: false });
  });

  it("links by hand to another adapter, then unlinks", async () => {
    const s = await seed();
    await s.link("web-analytics");
    expect(await s.analytics()).toMatchObject({ linked: true, adapterId: "web-analytics", isDefault: false });
    await s.link(null);
    expect(await s.analytics()).toMatchObject({ linked: false });
  });

  it("does not bring the default back after an unlink, but can be relinked to it", async () => {
    const s = await seed();
    await s.link(null);
    expect((await s.analytics()).linked).toBe(false);
    await s.link("postiz-analytics");
    expect(await s.analytics()).toMatchObject({ linked: true, adapterId: "postiz-analytics", isDefault: true });
  });

  it("refuses an adapter that needs the id of another service's Publisher", async () => {
    const s = await seed({ adapters: [POSTIZ_ANALYTICS, { id: "other-analytics", name: "Other", needs: "externalId", publisher: "other", earliestDelayMs: 0 }] });
    await expect(s.link("other-analytics")).rejects.toThrow(/other-analytics.*other/);
    expect(await s.analytics()).toMatchObject({ adapterId: "postiz-analytics" });
  });

  it("refuses an adapter that is not installed", async () => {
    const s = await seed();
    await expect(s.link("ghost")).rejects.toThrow(/not installed/);
  });

  it("only the owner links", async () => {
    const s = await seed();
    const stranger = s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" });
    await expect(
      stranger.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: TARGET, analyticsAdapter: null }),
    ).rejects.toThrow();
  });

  it("measures a Publication through the adapter its channel is linked to, and not at all once unlinked", async () => {
    const s = await seed();
    await s.link("web-analytics");
    loaded.ids.length = 0;
    const publicationId = await s.t.run(async (ctx) => {
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
        attemptContext: { adapter: "postiz", url: "https://postiz.example.com", channelId: "ch-1", publishable: { kind: "image" } },
        createdAt: now,
        updatedAt: now,
      });
    });
    vi.useFakeTimers();
    try {
      await s.t.mutation(internal.publications.finish, { publicationId, status: "published" });
      vi.advanceTimersByTime(24 * 3_600_000);
      await s.t.action(internal.analytics_node.collectDue, {});
      expect(loaded.ids).toEqual(["web-analytics"]);

      // Unlinked: the adapter is never loaded and the Publication reads "unmeasured" (analytics unavailable), not "no data yet".
      await s.link(null);
      loaded.ids.length = 0;
      await s.t.run(async (ctx) => {
        const row = await ctx.db.query("publicationAnalytics").first();
        if (row) await ctx.db.patch(row._id, { nextAt: 0 });
      });
      await s.t.action(internal.analytics_node.collectDue, {});
      expect(loaded.ids).toEqual([]);
      expect(await s.owner.query(api.analytics.forPublication, { publicationId })).toMatchObject({ state: "unmeasured" });
    } finally {
      vi.useRealTimers();
    }
  });
});
