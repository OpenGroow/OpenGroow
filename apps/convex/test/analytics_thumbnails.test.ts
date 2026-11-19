import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ANALYTICS_CONTRACT_VERSION, type AnalyticsAdapter } from "@opengroow/publisher-sdk";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// The Analytics page shows an article's thumbnail, read from the og:image of its public page.

const stub = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("../analytics/load_node.js", () => ({ loadAnalyticsAdapter: async () => stub.adapter }));
vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../analytics_adapters.ts": () => import("../analytics_adapters.js"),
  "../analytics_node.ts": () => import("../analytics_node.js"),
  "../analytics_thumbnails.ts": () => import("../analytics_thumbnails.js"),
  "../analytics_thumbnails_node.ts": () => import("../analytics_thumbnails_node.js"),
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

const DAY = 24 * 3_600_000;
const INSTANCE_ID = "openclaw-thumbs";
const TEMPLATE = fixtureTemplate("@test/blog", {
  missionTypes: [{ type: "write_post", label: "Post", payload: "{}", agentsMd: "a.md", publish: { kind: "article" }, analytics: {} }],
} as never);
useTemplateRegistry([INSTANCE_ID], [TEMPLATE]);
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|th", subject: "th-owner" };

const adapter: AnalyticsAdapter = {
  id: "stub",
  name: "Stub",
  contractVersion: ANALYTICS_CONTRACT_VERSION,
  needs: "externalId",
  earliestDelayMs: 0,
  async read() {
    return { ok: true, reading: { status: "no_data" } };
  },
};

let pages: Record<string, () => Response>;
let fetched: string[];
const html = (head: string) => new Response(`<html><head>${head}</head><body></body></html>`, { status: 200, headers: { "content-type": "text/html" } });

async function seed(opts: { externalUrl?: string; publishable?: Record<string, unknown> } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-1", channelName: "Blog", channelService: "instagram", channelProfile: "main" });
  await owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "instagram:main", analyticsAdapter: POSTIZ_ANALYTICS.id });
  const now = Date.now();
  const publicationId = await t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: "@test/blog",
      type: "write_post",
      payload: { publishTargets: ["instagram:main"] },
      status: "approved",
      ...(opts.publishable ? { lastArtifact: { publishable: opts.publishable } } : {}),
      createdAt: now,
      updatedAt: now,
    } as never);
    return await ctx.db.insert("publications", {
      missionId,
      instanceId: INSTANCE_ID,
      target: "instagram:main",
      status: "pending",
      externalId: "post-1",
      externalUrl: opts.externalUrl ?? "https://blog.example.com/posts/hello",
      attemptContext: { adapter: "postiz", url: "https://postiz.example.com", channelId: "ch-1", publishable: { kind: "article", title: "Hello", ...(opts.publishable ?? {}) } },
      createdAt: now,
      updatedAt: now,
    });
  });
  await t.mutation(internal.publications.finish, { publicationId, status: "published" });
  const refresh = () => owner.action(api.analytics_node.refresh, { instanceId: INSTANCE_ID });
  const thumbnail = async () => (await owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID }))[0]?.thumbnailUrl;
  return { t, owner, publicationId, refresh, thumbnail };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  stub.adapter = adapter;
  pages = {};
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      fetched.push(String(url));
      expect(init?.credentials).toBe("omit");
      return (pages[String(url)] ?? (() => new Response("", { status: 404 })))();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const PAGE = "https://blog.example.com/posts/hello";

describe("Thumbnail of a published article", () => {
  it("reads og:image from the public page on Refresh, with entities decoded", async () => {
    pages[PAGE] = () => html(`<meta content='https://cdn.example.com/a.png?x=1&amp;y=2' property="og:image">`);
    const s = await seed();
    expect(await s.thumbnail()).toBeUndefined();
    await s.refresh();
    expect(await s.thumbnail()).toBe("https://cdn.example.com/a.png?x=1&y=2");
  });

  it("falls back to twitter:image", async () => {
    pages[PAGE] = () => html(`<meta name="twitter:image" content="https://cdn.example.com/t.png">`);
    const s = await seed();
    await s.refresh();
    expect(await s.thumbnail()).toBe("https://cdn.example.com/t.png");
  });

  it("resolves a relative image against the page URL", async () => {
    pages[PAGE] = () => html(`<meta property="og:image" content="/img/cover.jpg">`);
    const s = await seed();
    await s.refresh();
    expect(await s.thumbnail()).toBe("https://blog.example.com/img/cover.jpg");
  });

  it("follows a redirect and resolves against the final page", async () => {
    pages[PAGE] = () => new Response(null, { status: 301, headers: { location: "https://blog.example.com/en/hello" } });
    pages["https://blog.example.com/en/hello"] = () => html(`<meta property="og:image" content="cover.jpg">`);
    const s = await seed();
    await s.refresh();
    expect(await s.thumbnail()).toBe("https://blog.example.com/en/cover.jpg");
  });

  it("stores nothing for a page without image and does not ask again before 7 days", async () => {
    pages[PAGE] = () => html(`<title>x</title>`);
    const s = await seed();
    await s.refresh();
    expect(await s.thumbnail()).toBeUndefined();
    expect(fetched).toEqual([PAGE]);
    await s.refresh();
    expect(fetched).toEqual([PAGE]);
    vi.advanceTimersByTime(8 * DAY);
    pages[PAGE] = () => html(`<meta property="og:image" content="https://cdn.example.com/late.png">`);
    await s.refresh();
    expect(fetched).toEqual([PAGE, PAGE]);
    expect(await s.thumbnail()).toBe("https://cdn.example.com/late.png");
  });

  it("does not ask again once an image is known", async () => {
    pages[PAGE] = () => html(`<meta property="og:image" content="https://cdn.example.com/a.png">`);
    const s = await seed();
    await s.refresh();
    vi.advanceTimersByTime(30 * DAY);
    await s.refresh();
    expect(fetched).toEqual([PAGE]);
  });

  it("refuses a local or private host without fetching it", async () => {
    for (const url of ["http://localhost/p", "http://127.0.0.1/p", "http://10.0.0.5/p", "http://169.254.169.254/p", "http://[::1]/p", "ftp://blog.example.com/p"]) {
      const s = await seed({ externalUrl: url });
      await s.refresh();
      expect(await s.thumbnail()).toBeUndefined();
    }
    expect(fetched).toEqual([]);
  });

  it("refuses a redirect to a private host", async () => {
    pages[PAGE] = () => new Response(null, { status: 302, headers: { location: "http://192.168.1.1/admin" } });
    const s = await seed();
    await s.refresh();
    expect(fetched).toEqual([PAGE]);
    expect(await s.thumbnail()).toBeUndefined();
  });

  it("keeps the Publishable's cover and does not fetch", async () => {
    pages[PAGE] = () => html(`<meta property="og:image" content="https://cdn.example.com/page.png">`);
    const s = await seed({ publishable: { kind: "article", markdownUrl: "https://cdn.example.com/p.md", coverUrl: "https://cdn.example.com/cover.png", slug: "hello", title: "Hello", description: "d" } });
    await s.refresh();
    expect(fetched).toEqual([]);
    expect(await s.thumbnail()).toBe("https://cdn.example.com/cover.png");
  });

  it("returns the cached value in the Analytics rows", async () => {
    const s = await seed();
    await s.t.mutation(internal.analytics_thumbnails.store, { entries: [{ publicationId: s.publicationId, url: "https://cdn.example.com/cached.png" }] });
    expect(await s.thumbnail()).toBe("https://cdn.example.com/cached.png");
  });
});
