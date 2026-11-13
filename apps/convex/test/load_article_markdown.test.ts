import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

// ADR-074: the review of an `article` shows the markdown of its Publishable.
// The dashboard talks only to Convex, so the markdown is read by an action,
// from the public `markdownUrl`, without any key.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
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

async function seedMission(t: ReturnType<typeof convexTest>, publishable: Record<string, unknown>) {
  const now = Date.now();
  return t.run((ctx) =>
    ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: "inst-article-md",
      templateId: "@acme/seo",
      type: "write_article",
      payload: {},
      status: "to_validate",
      lastResult: { status: "needs_human_review", summary: "ready", reviewQuestions: [] },
      lastArtifact: { external: { service: "seo", id: "a1" }, publishable: publishable as never },
      createdAt: now,
      updatedAt: now,
    }),
  );
}

describe("missions_node.loadArticleMarkdown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the markdown read from the article's markdownUrl, sending no key", async () => {
    const fetchMock = vi.fn(async () => new Response("## First step\n\nDig a hole.", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);

    const result = await t.withIdentity(OWNER).action(api.missions_node.loadArticleMarkdown, { missionId });

    expect(result).toEqual({ content: "## First step\n\nDig a hole." });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe(ARTICLE.markdownUrl);
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("refuses another user's Mission", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);
    await expect(t.withIdentity(OTHER).action(api.missions_node.loadArticleMarkdown, { missionId })).rejects.toThrow(/Forbidden/);
  });

  it("refuses a Mission whose Publishable is not an article", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "c" });
    await expect(t.withIdentity(OWNER).action(api.missions_node.loadArticleMarkdown, { missionId })).rejects.toThrow(/not an article/);
  });

  it("says the markdown could not be read when the URL answers an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const t = convexTest(schema, modules);
    const missionId = await seedMission(t, ARTICLE);
    await expect(t.withIdentity(OWNER).action(api.missions_node.loadArticleMarkdown, { missionId })).rejects.toThrow(/HTTP 404/);
  });
});
