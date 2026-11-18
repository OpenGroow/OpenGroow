import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { isThumbnailPage, ogImageOf } from "../source_thumbnails";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../instance_ownership.ts": () => import("../instance_ownership.js"),
  "../instances.ts": () => import("../instances.js"),
  "../source_thumbnails.ts": () => import("../source_thumbnails.js"),
  "../sources.ts": () => import("../sources.js"),
};

const INSTANCE = "thumbnails-instance";
const OWNER = { name: "Owner", email: "owner@example.com", tokenIdentifier: "test|thumbnails", subject: "owner-thumbnails" };
const NOW = 1_800_000_000_000;

describe("ogImageOf", () => {
  it("reads the og:image of an Instagram page and decodes its entities", () => {
    const html = '<head><meta property="og:title" content="x"><meta property="og:image" content="https://scontent-mad2-1.cdninstagram.com/v/a.jpg?stp=1&amp;oe=2"></head>';
    expect(ogImageOf(html)).toBe("https://scontent-mad2-1.cdninstagram.com/v/a.jpg?stp=1&oe=2");
  });

  it("accepts TikTok CDN hosts", () => {
    expect(ogImageOf('<meta property="og:image" content="https://p16-common-sign.tiktokcdn-eu.com/a.jpeg">')).toBe("https://p16-common-sign.tiktokcdn-eu.com/a.jpeg");
  });

  it("ignores an image from any other host, or over http", () => {
    expect(ogImageOf('<meta property="og:image" content="https://evil.example/a.jpg">')).toBeUndefined();
    expect(ogImageOf('<meta property="og:image" content="http://x.cdninstagram.com/a.jpg">')).toBeUndefined();
    expect(ogImageOf("<p>no meta</p>")).toBeUndefined();
  });

  it("only reads the pages of Instagram and TikTok", () => {
    expect(isThumbnailPage("https://www.instagram.com/reel/abc/")).toBe(true);
    expect(isThumbnailPage("https://www.tiktok.com/@a/photo/1")).toBe(true);
    expect(isThumbnailPage("https://example.com/reel/abc/")).toBe(false);
    expect(isThumbnailPage("https://instagram.com.evil.example/")).toBe(false);
    expect(isThumbnailPage("http://www.instagram.com/reel/abc/")).toBe(false);
  });
});

describe("source thumbnails", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function seed(t: ReturnType<typeof convexTest>, origin: string) {
    await t.run((ctx) => insertInstance(ctx, {
      jobId: "job-thumbnails", status: "running", runtimeStatus: "linked", runtimeReady: true,
      createdAt: new Date(NOW).toISOString(), openclawId: INSTANCE, updatedAt: new Date(NOW).toISOString(), userId: OWNER.subject,
    }));
    return await t.run((ctx) => ctx.db.insert("sources", {
      instanceId: INSTANCE, ownerId: OWNER.subject, templateId: "@opengroow/engagement", sourceId: "instagram-reel", label: "Reel", family: "social-video",
      status: "ready", origin, capturedAt: NOW, createdAt: NOW, marketing: {}, analysis: {},
    }));
  }

  it("stores the page's image and lists a URL for it", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seed(t, "https://www.instagram.com/reel/abc/");
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("instagram.com/reel")
        ? new Response('<meta property="og:image" content="https://x.cdninstagram.com/a.jpg">', { status: 200 })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.source_thumbnails.fetchThumbnail, { sourceId });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { "user-agent": "facebookexternalhit/1.1" } });
    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.thumbnailStorageId).toBeDefined();
    expect(row?.thumbnailTriedAt).toBe(NOW);
    const page = await t.withIdentity(OWNER).query(api.sources.listByInstance, { instanceId: INSTANCE, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page[0]?.thumbnailUrl).toEqual(expect.any(String));
  });

  it("records the attempt and keeps no thumbnail when the page has no usable image", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seed(t, "https://www.instagram.com/reel/abc/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<p>login</p>", { status: 200 })));

    await t.action(internal.source_thumbnails.fetchThumbnail, { sourceId });

    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.thumbnailStorageId).toBeUndefined();
    expect(row?.thumbnailTriedAt).toBe(NOW);
  });

  it("never requests a page outside Instagram and TikTok", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seed(t, "https://example.com/post/1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.source_thumbnails.fetchThumbnail, { sourceId });
    await t.withIdentity(OWNER).mutation(api.source_thumbnails.request, { instanceId: INSTANCE, sourceIds: [sourceId] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(sourceId)))?.thumbnailTriedAt).toBeUndefined();
  });

  it("request marks a Source once, so a second render does not ask again", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seed(t, "https://www.instagram.com/reel/abc/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    await t.withIdentity(OWNER).mutation(api.source_thumbnails.request, { instanceId: INSTANCE, sourceIds: [sourceId] });
    expect((await t.run((ctx) => ctx.db.get(sourceId)))?.thumbnailTriedAt).toBe(NOW);
    await t.run((ctx) => ctx.db.patch(sourceId, { thumbnailTriedAt: 5 }));
    await t.withIdentity(OWNER).mutation(api.source_thumbnails.request, { instanceId: INSTANCE, sourceIds: [sourceId] });
    expect((await t.run((ctx) => ctx.db.get(sourceId)))?.thumbnailTriedAt).toBe(5);
  });
});
