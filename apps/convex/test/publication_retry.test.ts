import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// ADR-069 amendment: retry without duplicate posts. A POST /posts that may have
// reached Postiz leaves the Publication `uncertain`; a retry reconciles with
// Postiz before sending again. Public Convex functions only; Postiz is faked.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-pub-retry";
const TEMPLATE_ID = "@test/image-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|pubr", subject: "pubr-owner" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|pubr-x", subject: "pubr-other" };

const imageTemplate = fixtureTemplate(TEMPLATE_ID, {
  missionTypes: [
    {
      type: "make_image",
      publish: { kind: "image" },
      review: {
        kind: "image",
        service: "workspace",
        actions: [
          { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
          { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
        ],
      },
    },
  ],
} as never);
const plainTemplate = fixtureTemplate("@test/plain", {
  missionTypes: [
    {
      type: "make_plain",
      review: {
        kind: "image",
        service: "workspace",
        actions: [{ key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" }],
      },
    },
  ],
} as never);
useTemplateRegistry([INSTANCE_ID], [imageTemplate, plainTemplate]);

const PUBLISHABLE = { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello world" };

async function seed(opts: { map?: boolean; payload?: Record<string, unknown>; templateId?: string; type?: string } = {}) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.subject,
    });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, {
    instanceId: INSTANCE_ID,
    adapter: "postiz",
    url: "https://postiz.example.com",
    apiKey: "secret",
  });
  if (opts.map !== false) {
    await owner.mutation(api.publishers.addChannel, {
      instanceId: INSTANCE_ID,
      channelId: "ch-1",
      channelName: "My IG",
      channelService: "instagram",
      channelProfile: "love_youmake",
    });
  }
  const now = Date.now();
  const missionId = await t.run(async (ctx) =>
    ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      type: opts.type ?? "make_image",
      payload: opts.payload ?? { publishTargets: ["instagram:love_youmake"] },
      status: "approved",
      lastResult: {
        status: "needs_human_review",
        summary: "Ready",
        reviewQuestions: [],
        artifact: { external: { service: "media", id: "42" }, publishable: PUBLISHABLE },
      },
      createdAt: now,
      updatedAt: now,
    } as never),
  );
  return { t, owner, missionId };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type PostMode = "ok" | "drop-after-accept" | "drop-before-accept" | "reject-4xx" | "server-error";

/** A stateful fake Postiz: it remembers the posts it accepted and lists them. */
function fakePostiz(initial: { mode?: PostMode; listingFails?: boolean } = {}) {
  const state = { mode: initial.mode ?? "ok", listingFails: initial.listingFails ?? false };
  const posts: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace("https://postiz.example.com/api/public/v1/", "");
    calls.push(`${init?.method ?? "GET"} ${path.split("?")[0]}`);
    if (path === "integrations") return json([{ id: "ch-1", name: "My IG", identifier: "instagram" }]);
    if (path === "upload-from-url") return json({ id: "media-1", path: "https://postiz.example.com/uploads/i.png" });
    if (path.startsWith("posts?")) {
      return state.listingFails ? json({}, 503) : json({ posts });
    }
    if (path === "posts" && init?.method === "POST") {
      const sent = JSON.parse(String(init.body));
      if (state.mode === "reject-4xx") return json({ error: "bad" }, 400);
      if (state.mode === "server-error") return json({ error: "boom" }, 502);
      if (state.mode === "drop-before-accept") throw new TypeError("fetch failed");
      const id = `post-${posts.length + 1}`;
      posts.push({
        id,
        state: sent.type === "now" ? "PUBLISHED" : "QUEUE",
        content: `<p>${sent.posts[0].value[0].content}</p>`,
        publishDate: sent.date,
        createdAt: new Date().toISOString(),
        integration: { id: sent.posts[0].integration.id },
        releaseURL: "https://instagram.com/p/x",
      });
      if (state.mode === "drop-after-accept") throw new TypeError("fetch failed");
      return json([{ postId: id, integration: "ch-1" }]);
    }
    return json({ error: "unexpected " + path }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return { state, posts, calls, count: (what: string) => calls.filter((c) => c === what).length };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const publish = (ctx: Awaited<ReturnType<typeof seed>>) =>
  ctx.owner.action(api.missions_node.performReviewAction, { missionId: ctx.missionId, actionKey: "publish" });
const listed = async (ctx: Awaited<ReturnType<typeof seed>>) =>
  (await ctx.owner.query(api.publications.listForMission, { missionId: ctx.missionId }))[0];
const retry = async (ctx: Awaited<ReturnType<typeof seed>>) =>
  ctx.owner.action(api.publisher_node.retryPublication, { publicationId: (await listed(ctx)).id });

describe("a POST that may have reached Postiz", () => {
  it("leaves the Publication uncertain (not failed) when the connection drops after Postiz accepted", async () => {
    const ctx = await seed();
    fakePostiz({ mode: "drop-after-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    const p = await listed(ctx);
    expect(p.status).toBe("uncertain");
    expect(p.error).toContain("Postiz may have received this post; it will be checked before any new attempt");
    expect((await ctx.owner.query(api.missions.get, { missionId: ctx.missionId }))?.status).toBe("approved");
  });

  it("is uncertain on a 5xx too", async () => {
    const ctx = await seed();
    fakePostiz({ mode: "server-error" });
    await expect(publish(ctx)).rejects.toThrow();
    expect((await listed(ctx)).status).toBe("uncertain");
  });

  it("stays failed on a clear 4xx rejection", async () => {
    const ctx = await seed();
    fakePostiz({ mode: "reject-4xx" });
    await expect(publish(ctx)).rejects.toThrow(/400/);
    expect((await listed(ctx)).status).toBe("failed");
  });
});

describe("retry reconciles before sending again", () => {
  it("finds the post Postiz accepted and creates no second one", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "drop-after-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.state.mode = "ok";

    await retry(ctx);

    expect(postiz.count("POST posts")).toBe(1);
    expect(postiz.posts).toHaveLength(1);
    const p = await listed(ctx);
    expect(p).toMatchObject({ status: "published", externalId: "post-1" });
    expect((await ctx.owner.query(api.missions.get, { missionId: ctx.missionId }))?.status).toBe("done");
  });

  it("attaches a scheduled post as scheduled", async () => {
    const publishAt = Date.now() + 2 * 3_600_000;
    const ctx = await seed({ payload: { publishTargets: ["instagram:love_youmake"], publishAt } });
    const postiz = fakePostiz({ mode: "drop-after-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.state.mode = "ok";
    await retry(ctx);
    expect(postiz.count("POST posts")).toBe(1);
    expect(await listed(ctx)).toMatchObject({ status: "scheduled", externalId: "post-1", scheduledAt: publishAt });
  });

  it("sends once when Postiz never received the post", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "drop-before-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    expect((await listed(ctx)).status).toBe("uncertain");
    postiz.state.mode = "ok";

    await retry(ctx);

    expect(postiz.count("POST posts")).toBe(2); // the dropped one + exactly one retry
    expect(postiz.posts).toHaveLength(1);
    expect((await listed(ctx)).status).toBe("published");
  });

  it("does not match a post with another caption or on another channel", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "server-error" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.posts.push(
      { id: "other-1", state: "PUBLISHED", content: "<p>Something else</p>", publishDate: new Date().toISOString(), createdAt: new Date().toISOString(), integration: { id: "ch-1" } },
      { id: "other-2", state: "PUBLISHED", content: "<p>Hello world</p>", publishDate: new Date().toISOString(), createdAt: new Date().toISOString(), integration: { id: "ch-2" } },
    );
    postiz.state.mode = "ok";
    await retry(ctx);
    // Neither look-alike matched, so exactly one new post was sent.
    expect(postiz.count("POST posts")).toBe(2);
    expect((await listed(ctx)).externalId).toBe("post-3");
  });

  it("does not send again when Postiz cannot be listed: it stays uncertain", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "drop-after-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.state.mode = "ok";
    postiz.state.listingFails = true;
    const before = postiz.count("POST posts");
    await expect(retry(ctx)).rejects.toThrow();
    expect(postiz.count("POST posts")).toBe(before);
    expect((await listed(ctx)).status).toBe("uncertain");
  });

  it("reconciles a failed Publication that still carries an attempt window, but not one Postiz clearly rejected", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "reject-4xx" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.state.mode = "ok";
    await retry(ctx);
    expect(postiz.count("GET posts")).toBe(0);
    expect(postiz.count("POST posts")).toBe(2);
    expect((await listed(ctx)).status).toBe("published");

    // A failed row that kept its window (for example from before this change) is reconciled.
    const ctx2 = await seed();
    const accepted = fakePostiz({ mode: "drop-after-accept" });
    await expect(publish(ctx2)).rejects.toThrow();
    await ctx2.t.run(async (c) => {
      for (const p of await c.db.query("publications").collect()) await c.db.patch(p._id, { status: "failed" });
    });
    accepted.state.mode = "ok";
    await retry(ctx2);
    expect(accepted.count("POST posts")).toBe(1);
    expect((await listed(ctx2)).externalId).toBe("post-1");
  });
});

describe("media ids", () => {
  it("are kept on the Publication and reused by the retry instead of uploading again", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "drop-before-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    expect(postiz.count("POST upload-from-url")).toBe(1);
    postiz.state.mode = "ok";
    await retry(ctx);
    expect(postiz.count("POST upload-from-url")).toBe(1);
    expect(postiz.count("POST posts")).toBe(2);
    expect((await listed(ctx)).status).toBe("published");
  });
});

describe("concurrent submits", () => {
  it("send once when published twice at the same time", async () => {
    const ctx = await seed();
    const postiz = fakePostiz();
    const results = await Promise.allSettled([publish(ctx), publish(ctx)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(postiz.count("POST posts")).toBe(1);
    expect(postiz.posts).toHaveLength(1);
  });

  it("send once when an uncertain Publication is retried twice at the same time", async () => {
    const ctx = await seed();
    const postiz = fakePostiz({ mode: "drop-before-accept" });
    await expect(publish(ctx)).rejects.toThrow();
    postiz.state.mode = "ok";
    const before = postiz.count("POST posts");
    await Promise.allSettled([retry(ctx), retry(ctx)]);
    expect(postiz.count("POST posts")).toBe(before + 1);
  });
});
