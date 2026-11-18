import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { normalizePostUrl } from "../post_url";

// Issue #89, ADR-078: a Publication keeps the post's public URL, normalized
// the same way when it is stored and when it is matched, and a retry that
// creates a new post starts a new series.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../publications.ts": () => import("../publications.js"),
};

describe("normalizePostUrl", () => {
  it.each([
    ["https://blog.example/blog/my-slug/", "https://blog.example/blog/my-slug"],
    ["https://Blog.Example/blog/my-slug?utm_source=x&utm_medium=y&fbclid=z", "https://blog.example/blog/my-slug"],
    ["https://www.instagram.com/reel/abc123/?igsh=xyz", "https://www.instagram.com/reel/abc123"],
    ["https://blog.example/p?id=2&utm_campaign=c&a=1", "https://blog.example/p?a=1&id=2"],
    ["https://blog.example/", "https://blog.example"],
    ["https://blog.example/post#comments", "https://blog.example/post"],
    ["not a url", "not a url"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePostUrl(input)).toBe(expected);
  });

  it("gives the same result for two spellings of one post", () => {
    expect(normalizePostUrl("https://x.com/a/status/1/?utm_source=t")).toBe(normalizePostUrl("https://X.com/a/status/1"));
  });
});

async function seedPublication() {
  const t = convexTest(schema, modules);
  const publicationId = await t.run(async (ctx) => {
    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      ownerId: "o", instanceId: "i", templateId: "@t/t", type: "x", payload: {}, status: "approved", createdAt: now, updatedAt: now,
    } as never);
    return ctx.db.insert("publications", {
      missionId, instanceId: "i", target: "instagram:me", status: "pending", createdAt: now, updatedAt: now,
    });
  });
  const row = () => t.run((ctx) => ctx.db.get(publicationId));
  return { t, publicationId, row };
}

describe("Publication post URL and series", () => {
  it("stores the URL the Publisher returns, normalized", async () => {
    const { t, publicationId, row } = await seedPublication();
    await t.mutation(internal.publications.finish, {
      publicationId, status: "published", externalId: "p1", externalUrl: "https://www.instagram.com/reel/abc/?igsh=1",
    });
    expect((await row())?.externalUrl).toBe("https://www.instagram.com/reel/abc");
  });

  it("keeps the same series when the retry finds the same post", async () => {
    const { t, publicationId, row } = await seedPublication();
    await t.mutation(internal.publications.finish, { publicationId, status: "published", externalId: "p1" });
    await t.mutation(internal.publications.finish, { publicationId, status: "published", externalId: "p1", externalUrl: "https://a.example/x" });
    expect((await row())?.postSeries ?? 0).toBe(0);
  });

  it("starts a new series when a retry creates a different post", async () => {
    const { t, publicationId, row } = await seedPublication();
    await t.mutation(internal.publications.finish, { publicationId, status: "published", externalId: "p1" });
    await t.mutation(internal.publications.finish, { publicationId, status: "failed", error: "deleted" });
    await t.mutation(internal.publications.finish, { publicationId, status: "published", externalId: "p2" });
    const after = await row();
    expect(after?.externalId).toBe("p2");
    expect(after?.postSeries).toBe(1);
  });
});
