import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ANALYTICS_CONTRACT_VERSION, type AnalyticsAdapter, type AnalyticsConnection, type AnalyticsKey, type ReadRequest } from "@opengroow/publisher-sdk";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// ADR-078, issue #88: a Publication that becomes `published` receives
// append-only Performance Snapshots 1, 3 and 7 days after. Driven through the
// public query and the collection tick, with a stub Analytics Adapter that
// reads over a stubbed `fetch` (Seam 1).

const stub = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("../analytics/load_node.js", () => ({ loadAnalyticsAdapter: async () => stub.adapter }));
vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
  "../analytics_node.ts": () => import("../analytics_node.js"),
  "../analytics_connections.ts": () => import("../analytics_connections.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_notifications.ts": () => import("../publication_notifications.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INSTANCE_ID = "openclaw-analytics";
const MEASURED = fixtureTemplate("@test/social", {
  missionTypes: [
    { type: "make_image", label: "Image", payload: "{}", agentsMd: "a.md", publish: { kind: "image" }, analytics: { primaryMetric: "views" } },
    { type: "make_short", label: "Short", payload: "{}", agentsMd: "b.md", publish: { kind: "image" }, analytics: { primaryMetric: "views", collect: [2] } },
    { type: "make_plain", label: "Plain", payload: "{}", agentsMd: "c.md", publish: { kind: "image" } },
  ],
} as never);
useTemplateRegistry([INSTANCE_ID], [MEASURED]);

const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|an", subject: "an-owner" };

/** Stub adapter: asks `https://stats.example.com/post/<key>` and maps the answer. */
function stubAdapter(opts: { needs?: AnalyticsKey; earliestDelayMs?: number } = {}): AnalyticsAdapter {
  return {
    id: "stub",
    name: "Stub",
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    needs: opts.needs ?? "externalId",
    earliestDelayMs: opts.earliestDelayMs ?? 0,
    async read(conn, request: ReadRequest) {
      connections.push(conn);
      let response: Response;
      try {
        response = await fetch(`https://stats.example.com/post/${request.externalId ?? request.url}`, {
          headers: { authorization: conn.apiKey },
        });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
      if (response.status === 404) return { ok: true, reading: { status: "unavailable", reason: "Post not found at the service" } };
      if (!response.ok) return { ok: false, error: `Service answered ${response.status}` };
      const body = (await response.json()) as Record<string, unknown> | null;
      if (!body) return { ok: true, reading: { status: "no_data" } };
      return { ok: true, reading: { status: "taken", metrics: body } };
    },
  };
}

type Answer = () => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let answer: Answer;
let reads: string[];
const connections: AnalyticsConnection[] = [];

async function seed(opts: { externalId?: string | null; externalUrl?: string; status?: "published" | "scheduled"; type?: string } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
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
  const now = Date.now();
  const publicationId = await t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: "@test/social",
      type: opts.type ?? "make_image",
      payload: { publishTargets: ["instagram:love_youmake"] },
      status: "approved",
      createdAt: now,
      updatedAt: now,
    } as never);
    return await ctx.db.insert("publications", {
      missionId,
      instanceId: INSTANCE_ID,
      target: "instagram:love_youmake",
      status: opts.status ?? "pending",
      ...(opts.externalId === null ? {} : { externalId: opts.externalId ?? "post-1" }),
      ...(opts.externalUrl ? { externalUrl: opts.externalUrl } : {}),
      attemptContext: { adapter: "postiz", url: "https://postiz.example.com", channelId: "ch-1", publishable: { kind: "image", caption: "hi" } },
      createdAt: now,
      updatedAt: now,
    });
  });
  const publish = () => t.mutation(internal.publications.finish, { publicationId, status: "published" });
  const tick = async () => {
    await t.action(internal.analytics_node.collectDue, {});
  };
  const view = async () => {
    const result = await owner.query(api.analytics.forPublication, { publicationId });
    if (!result) throw new Error("No view");
    return result;
  };
  return { t, owner, publicationId, publish, tick, view };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  stub.adapter = stubAdapter();
  reads = [];
  connections.length = 0;
  answer = () => json({ views: 146, reach: 116, likes: 2, comments: 0, shares: 0, saves: 0, impressions: 999 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      reads.push(String(url));
      return answer();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Performance Snapshots (ADR-078)", () => {
  it("stores the declared non-derived keys of a contract 2 adapter and drops the others (ADR-079)", async () => {
    const s = await seed();
    await installAnalyticsAdapter(s.t, {
      id: "search-console",
      name: "Search Console",
      needs: "externalId",
      publisher: "postiz",
      earliestDelayMs: 0,
      primary: "clicks",
      metrics: [
        { key: "clicks", label: "Clicks", type: "counter", format: "number" },
        { key: "impressions", label: "Impressions", type: "counter", format: "number" },
        { key: "ctr", label: "CTR", type: "level", format: "percent", derive: { sum: ["clicks"], per: "impressions" } },
        { key: "position", label: "Position", type: "level", format: "number", better: "lower" },
      ],
    });
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:love_youmake", analyticsAdapter: "search-console" });
    await s.publish();
    vi.advanceTimersByTime(DAY);
    answer = () => json({ clicks: 46, impressions: 1900, ctr: 0.024, position: 11.8, views: 5, stray: 1 });
    await s.tick();
    expect((await s.view()).snapshots[0].metrics).toEqual({ clicks: 46, impressions: 1900, position: 11.8 });
  });

  it("takes no reading before the first delay, then one Snapshot at 1, 3 and 7 days", async () => {
    const s = await seed();
    await s.publish();
    await s.tick();
    expect(reads).toEqual([]);
    expect((await s.view()).state).toBe("waiting");

    vi.advanceTimersByTime(DAY);
    await s.tick();
    vi.advanceTimersByTime(3 * DAY);
    await s.tick();
    vi.advanceTimersByTime(3 * DAY);
    await s.tick();

    const view = await s.view();
    expect(view.snapshots.map((x) => x.delayMs)).toEqual([DAY, 3 * DAY, 7 * DAY]);
    expect(view.snapshots[0]).toMatchObject({ metrics: { views: 146, reach: 116, likes: 2, comments: 0, shares: 0, saves: 0 }, source: "adapter" });
    // Unknown metrics are ignored.
    expect(view.snapshots[0].metrics).not.toHaveProperty("impressions");
    expect(view.state).toBe("complete");
    expect(reads).toHaveLength(3);
    await s.tick();
    expect(reads).toHaveLength(3);
  });

  it("counts the delay from `published`, not from when the Publication was created", async () => {
    const s = await seed();
    vi.advanceTimersByTime(5 * DAY); // created long before it was published
    await s.publish();
    vi.advanceTimersByTime(DAY - 1);
    await s.tick();
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(1);
    await s.tick();
    expect(reads).toHaveLength(1);
  });

  it("waits for the later of the Template delay and the adapter's earliest delay", async () => {
    stub.adapter = stubAdapter({ earliestDelayMs: 2 * DAY });
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(reads).toHaveLength(1);
    // The 3-day reading still comes at 3 days.
    vi.advanceTimersByTime(DAY - 1);
    await s.tick();
    expect(reads).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await s.tick();
    expect(reads).toHaveLength(2);
  });

  it("tries no reading while the Publication lacks the key the adapter needs", async () => {
    stub.adapter = stubAdapter({ needs: "url" });
    const s = await seed({ externalUrl: undefined });
    await s.publish();
    vi.advanceTimersByTime(2 * DAY);
    await s.tick();
    expect(reads).toEqual([]);
    expect((await s.view()).state).toBe("waiting");
    // Once the link is known, the reading is taken and goes by URL.
    await s.t.run(async (ctx) => ctx.db.patch(s.publicationId, { externalUrl: "https://blog.example/p" }));
    vi.advanceTimersByTime(HOUR);
    await s.tick();
    expect(reads).toEqual(["https://stats.example.com/post/https://blog.example/p"]);
  });

  it("retries 'no data yet' and shows it as such", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    answer = () => json(null);
    await s.tick();
    let view = await s.view();
    expect(view.state).toBe("no_data");
    expect(view.snapshots).toEqual([]);
    expect(view.nextAt).toBeGreaterThan(Date.now());

    answer = () => json({ views: 5 });
    vi.advanceTimersByTime(HOUR);
    await s.tick();
    view = await s.view();
    expect(view.state).toBe("waiting");
    expect(view.snapshots).toHaveLength(1);
  });

  it("retries a failure, shows its reason, and leaves the Publication published", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    answer = () => json({ error: "bad token" }, 401);
    await s.tick();
    const view = await s.view();
    expect(view).toMatchObject({ state: "failed", reason: "Service answered 401" });
    const publication = await s.t.run(async (ctx) => ctx.db.get(s.publicationId));
    expect(publication?.status).toBe("published");

    answer = () => json({ views: 7 });
    vi.advanceTimersByTime(HOUR);
    await s.tick();
    expect((await s.view()).snapshots).toHaveLength(1);
  });

  it("treats an adapter that throws as a failed reading", async () => {
    const adapter = stubAdapter();
    stub.adapter = { ...adapter, read: async () => { throw new Error("boom"); } };
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(await s.view()).toMatchObject({ state: "failed", reason: "boom" });
  });

  it("stops at 'unavailable' when the service does not know the post, keeping history", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    vi.advanceTimersByTime(2 * DAY);
    answer = () => json({}, 404);
    await s.tick();
    const view = await s.view();
    expect(view).toMatchObject({ state: "post_unknown", reason: "Post not found at the service" });
    expect(view.snapshots).toHaveLength(1);
    const before = reads.length;
    vi.advanceTimersByTime(10 * DAY);
    await s.tick();
    expect(reads).toHaveLength(before);
  });

  it("never rewrites a Snapshot: a later reading adds a row", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    const first = (await s.view()).snapshots[0];
    answer = () => json({ views: 1000 });
    vi.advanceTimersByTime(2 * DAY);
    await s.tick();
    const view = await s.view();
    expect(view.snapshots[0]).toEqual(first);
    expect(view.snapshots[1].metrics).toEqual({ views: 1000 });
  });

  it("leaves a Project without an Analytics Adapter unchanged", async () => {
    stub.adapter = null;
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(8 * DAY);
    await s.tick();
    expect(reads).toEqual([]);
    expect(await s.view()).toMatchObject({ state: "unmeasured", snapshots: [] });
    const publication = await s.t.run(async (ctx) => ctx.db.get(s.publicationId));
    expect(publication?.status).toBe("published");
  });

  it("starts a new series when a retried Publication creates a new post, keeping the old Snapshots", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect((await s.view()).snapshots.map((x) => x.postSeries)).toEqual([0]);

    // The retry created another post: a new `externalId`.
    await s.t.mutation(internal.publications.finish, { publicationId: s.publicationId, status: "published", externalId: "post-2" });
    let view = await s.view();
    expect(view.state).toBe("waiting");
    expect(view.snapshots).toHaveLength(1);

    // The old post is no longer measured; the new one starts its own 1, 3, 7 day curve.
    reads.length = 0;
    vi.advanceTimersByTime(2 * DAY);
    await s.tick();
    expect(reads).toEqual(["https://stats.example.com/post/post-2"]);
    view = await s.view();
    expect(view.snapshots.map((x) => [x.postSeries, x.delayMs])).toEqual([
      [0, DAY],
      [1, DAY],
    ]);
  });

  it("reads with the Publisher's connection until the Project configures the adapter, then with its own connection and options", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(connections).toEqual([{ url: "https://postiz.example.com", apiKey: "secret" }]);

    await s.owner.mutation(api.analytics_connections.save, {
      instanceId: INSTANCE_ID,
      adapter: "postiz-analytics",
      url: "https://stats.postiz.example.com",
      apiKey: "analytics-key",
      options: { lookbackDays: 30 },
    });
    vi.advanceTimersByTime(2 * DAY);
    await s.tick();
    expect(connections[1]).toEqual({ url: "https://stats.postiz.example.com", apiKey: "analytics-key", options: { lookbackDays: 30 } });
  });

  it("follows the Template's `collect` delays", async () => {
    const s = await seed({ type: "make_short" });
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(DAY);
    await s.tick();
    const view = await s.view();
    expect(view.snapshots.map((x) => x.delayMs)).toEqual([2 * DAY]);
    expect(view.state).toBe("complete");
  });

  it("does not measure a Mission type that declares no `analytics`", async () => {
    const s = await seed({ type: "make_plain" });
    await s.publish();
    vi.advanceTimersByTime(8 * DAY);
    await s.tick();
    expect(reads).toEqual([]);
    expect(await s.view()).toMatchObject({ state: "unmeasured", snapshots: [] });
    expect(await s.t.run(async (ctx) => ctx.db.query("publicationAnalytics").collect())).toEqual([]);
  });

  it("resumes measuring once an adapter is linked after the reading found none", async () => {
    stub.adapter = null;
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(await s.view()).toMatchObject({ state: "unmeasured" });
    stub.adapter = stubAdapter();
    vi.advanceTimersByTime(HOUR);
    await s.tick();
    expect(reads).toHaveLength(1);
    expect((await s.view()).snapshots).toHaveLength(1);
  });

  it("tells the owner when the Project has no connection to the adapter", async () => {
    const s = await seed();
    await s.t.run(async (ctx) => {
      const publisher = await ctx.db.query("publishers").first();
      if (publisher) await ctx.db.patch(publisher._id, { apiKey: undefined });
    });
    await s.publish();
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect(reads).toEqual([]);
    expect(await s.view()).toMatchObject({ state: "failed", reason: expect.stringContaining("no connection") });
  });

  it("starts a new series when a retry gives no id but another post URL", async () => {
    const s = await seed({ externalId: null, externalUrl: "https://blog.example/a" });
    await s.publish();
    await s.t.mutation(internal.publications.finish, { publicationId: s.publicationId, status: "published", externalUrl: "https://blog.example/a/?utm_source=x" });
    expect(await s.t.run(async (ctx) => (await ctx.db.get(s.publicationId))?.postSeries ?? 0)).toBe(0);
    await s.t.mutation(internal.publications.finish, { publicationId: s.publicationId, status: "published", externalUrl: "https://blog.example/b" });
    expect(await s.t.run(async (ctx) => (await ctx.db.get(s.publicationId))?.postSeries)).toBe(1);
  });

  it("does not show another owner's Snapshots", async () => {
    const s = await seed();
    await s.publish();
    const stranger = s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" });
    expect(await stranger.query(api.analytics.forPublication, { publicationId: s.publicationId })).toBeNull();
  });

  it("reads every measured post now on Refresh, as Snapshots outside the schedule", async () => {
    const s = await seed();
    await s.publish();
    vi.advanceTimersByTime(HOUR);
    const result = await s.owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
    expect(result).toEqual({ read: 1, unavailable: 0, failed: 0 });
    const view = await s.view();
    expect(view.snapshots).toHaveLength(1);
    expect(view.snapshots[0]).toMatchObject({ delayMs: HOUR, source: "refresh", metrics: { views: 146 } });
    // The schedule is not advanced: the 1 day reading is still taken.
    expect(view.state).toBe("waiting");
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect((await s.view()).snapshots.map((x) => x.delayMs)).toEqual([HOUR, DAY]);
  });

  it("reports what a refresh could not read, without recording it", async () => {
    const s = await seed();
    await s.publish();
    answer = () => json({}, 500);
    const result = await s.owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
    expect(result).toEqual({ read: 0, unavailable: 0, failed: 1, error: "Service answered 500" });
    const view = await s.view();
    expect(view.snapshots).toEqual([]);
    expect(view.state).toBe("waiting");
  });

  it("refuses a refresh of someone else's Project", async () => {
    const s = await seed();
    await s.publish();
    await expect(s.t.withIdentity({ name: "X", email: "x@e.com", tokenIdentifier: "test|x", subject: "x" }).action(api.analytics_node.refresh, { instanceId: INSTANCE_ID })).rejects.toThrow();
  });

  it("gives a post published before it was measured its row on Refresh, scheduling only the delays to come", async () => {
    const s = await seed({ status: "published" });
    vi.advanceTimersByTime(2 * DAY);
    const result = await s.owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
    expect(result).toEqual({ read: 1, unavailable: 0, failed: 0 });
    const view = await s.view();
    expect(view.snapshots).toHaveLength(1);
    expect(view.snapshots[0]).toMatchObject({ delayMs: 2 * DAY, source: "refresh" });
    // The 1 day reading is long gone and is not recorded late; the 3 and 7 day ones are still scheduled.
    expect(view.state).toBe("waiting");
    vi.advanceTimersByTime(DAY);
    await s.tick();
    expect((await s.view()).snapshots.map((x) => x.delayMs)).toEqual([2 * DAY, 3 * DAY]);
  });

  it("reads a post older than every delay once, on Refresh, and keeps it complete", async () => {
    const s = await seed({ status: "published" });
    vi.advanceTimersByTime(30 * DAY);
    await s.owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
    const view = await s.view();
    expect(view.snapshots).toHaveLength(1);
    expect(view.state).toBe("complete");
  });

  it("does not measure a post whose Mission type declares no analytics, even on Refresh", async () => {
    const s = await seed({ status: "published", type: "make_plain" });
    const result = await s.owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
    expect(result).toEqual({ read: 0, unavailable: 0, failed: 0 });
    expect((await s.view()).state).toBe("unmeasured");
  });
});
