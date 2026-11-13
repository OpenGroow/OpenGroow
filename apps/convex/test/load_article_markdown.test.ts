import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";

// ADR-074: the review of an `article` shows the markdown of its Publishable.
// The dashboard talks only to Convex, so the markdown is read by an action,
// from the public `markdownUrl`, without any key.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../mission_articles.ts": () => import("../mission_articles.js"),
};

const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|article-md", subject: "owner-article-md" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|article-md-x", subject: "other-article-md" };
const ARTICLE = {
  kind: "article",
  markdownUrl: "https://seo.example.com/articles/a1.md",
  coverUrl: "https://seo.example.com/articles/a1.webp",
  slug: "how-to-grow",
  title: "How to grow",
  description: "A short guide",
};

async function seedMission(t: ReturnType<typeof convexTest>, publishable: Record<string, unknown>, ownerId = OWNER.subject) {
  const now = Date.now();
  return t.run(async (ctx) => {
    await insertInstance(ctx, {
      jobId: "article-md",
      openclawId: "inst-article-md",
      status: "running",
      userId: OWNER.tokenIdentifier,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    return ctx.db.insert("missions", {
      ownerId,
      instanceId: "inst-article-md",
      templateId: "@acme/seo",
      type: "write_article",
      payload: {},
      status: "to_validate",
      lastResult: { status: "needs_human_review", summary: "ready", reviewQuestions: [] },
      lastArtifact: { external: { service: "seo", id: "a1" }, publishable: publishable as never },
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("mission_articles.loadMarkdown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the markdown read from the article's markdownUrl, sending no key", async () => {
    const fetchMock = vi.fn(async () => new Response("## First step\n\nDig a hole.", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);

    const result = await t.withIdentity(OWNER).action(api.mission_articles.loadMarkdown, { missionId });

    expect(result).toEqual({ content: "## First step\n\nDig a hole." });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe(ARTICLE.markdownUrl);
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("refuses another user's Mission", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);
    await expect(t.withIdentity(OTHER).action(api.mission_articles.loadMarkdown, { missionId })).rejects.toThrow(/Forbidden/);
  });

  it("accepts a Mission attributed to the full token identifier", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# Article")));
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE, OWNER.tokenIdentifier);
    await expect(t.withIdentity(OWNER).action(api.mission_articles.loadMarkdown, { missionId }))
      .resolves.toEqual({ content: "# Article" });
  });

  it.each([OWNER.subject, OWNER.tokenIdentifier])("refuses a different issuer with the same subject (stored owner: %s)", async (ownerId) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE, ownerId);
    const impersonator = { ...OWNER, tokenIdentifier: "other-issuer|article-md" };
    await expect(t.withIdentity(impersonator).action(api.mission_articles.loadMarkdown, { missionId }))
      .rejects.toThrow(/Forbidden/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated read before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);
    await expect(t.action(api.mission_articles.loadMarkdown, { missionId }))
      .rejects.toThrow(/Authentication required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a Mission whose Publishable is not an article", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "c" });
    await expect(t.withIdentity(OWNER).action(api.mission_articles.loadMarkdown, { missionId })).rejects.toThrow(/not an article/);
  });

  it("says the markdown could not be read when the URL answers an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);
    await expect(t.withIdentity(OWNER).action(api.mission_articles.loadMarkdown, { missionId })).rejects.toThrow(/HTTP 404/);
  });
});
