import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { createInMemoryTemplateRegistry } from "@opengroow/agent-templates/registry";
import { setTemplateRegistryForTests } from "../template_registry";
import { NOTIFICATION_ABANDONED_AFTER_MS } from "../publication_notifications";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// Issue #62, ADR-074: `publish.onPublished` notifies the producing service once
// per Publication reaching `published`. Never blocking: a failed call leaves
// the Mission `done` with a warning, and the call can be resent.
// Public Convex functions only; Postiz and the MCP are faked over fetch.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_notifications.ts": () => import("../publication_notifications.js"),
  "../publication_notify_node.ts": () => import("../publication_notify_node.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-on-published";
const TEMPLATE_ID = "@test/notifying-maker";
const PLAIN_TEMPLATE_ID = "@test/silent-maker";
const URL_TEMPLATE_ID = "@test/url-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|onp", subject: "onp-owner" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|onp-x", subject: "onp-other" };

const missionType = (type: string, onPublished?: unknown) => ({
  type,
  publish: { kind: "image", ...(onPublished ? { onPublished } : {}) },
  review: {
    kind: "image",
    service: "workspace",
    actions: [
      { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
      { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
    ],
  },
});
const notifyingTemplate = fixtureTemplate(TEMPLATE_ID, {
  mcpServers: [{ name: "site-mcp", transport: "streamable-http", url: "https://mcp.example.com/mcp" }],
  missionTypes: [
    missionType("make_image", {
      server: "site-mcp",
      method: "POST",
      path: "/articles/{id}/published",
      body: { postId: "{publication.externalId}" },
      responseIndexingField: "indexing",
    }),
  ],
} as never);
// Sends the post's URL: Postiz reports `published` first and the link on a later poll.
const urlTemplate = fixtureTemplate(URL_TEMPLATE_ID, {
  name: "Site Writer",
  mcpServers: [{ name: "site-mcp", transport: "streamable-http", url: "https://mcp.example.com/mcp" }],
  missionTypes: [
    missionType("make_image", {
      server: "site-mcp",
      method: "POST",
      path: "/articles/{id}/published",
      body: { url: "{publication.externalUrl}" },
    }),
  ],
} as never);
const silentTemplate = fixtureTemplate(PLAIN_TEMPLATE_ID, { missionTypes: [missionType("make_image")] } as never);
useTemplateRegistry([INSTANCE_ID], [notifyingTemplate, silentTemplate, urlTemplate]);

async function seed(opts: { templateId?: string } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  const templateId = opts.templateId ?? TEMPLATE_ID;
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, {
      jobId: `job-${INSTANCE_ID}`,
      status: "running",
      createdAt: now,
      openclawId: INSTANCE_ID,
      updatedAt: now,
      userId: OWNER.tokenIdentifier,
    });
    await ctx.db.insert("projectAgents", {
      instanceId: INSTANCE_ID,
      templateId,
      status: "active",
      mcpServerKeys: ["site-mcp"],
      config: { apiKey: "agent-key" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, {
    instanceId: INSTANCE_ID,
    adapter: "postiz",
    url: "https://postiz.example.com",
    apiKey: "secret",
  });
  await owner.mutation(api.publishers.addChannel, {
    adapter: "postiz",
    instanceId: INSTANCE_ID,
    channelId: "ch-1",
    channelName: "My IG",
    channelService: "instagram",
    channelProfile: "love_youmake",
  });
  const now = Date.now();
  const missionId = await t.run(async (ctx) =>
    ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId,
      type: "make_image",
      payload: { publishTargets: ["instagram:love_youmake"] },
      status: "approved",
      lastResult: {
        status: "needs_human_review",
        summary: "Ready",
        reviewQuestions: [],
        artifact: {
          external: { service: "site", id: "art 7" },
          publishable: { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello world" },
        },
      },
      createdAt: now,
      updatedAt: now,
    } as never),
  );
  return { t, owner, missionId };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Postiz accepts every post; the MCP answers as `mcp.answer` says. */
function fakeServices() {
  const mcp = {
    answer: (): Response => json({ ok: true, indexing: { status: "submitted", provider: "speedyindex", taskId: "task-1" } }),
    calls: [] as Array<{ url: string; headers: Record<string, string>; body: unknown }>,
  };
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (href.startsWith("https://mcp.example.com/")) {
        mcp.calls.push({
          url: href,
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return mcp.answer();
      }
      const path = href.replace("https://postiz.example.com/api/public/v1/", "");
      if (path === "integrations") return json([{ id: "ch-1", name: "My IG", identifier: "instagram" }]);
      if (path === "upload-from-url") return json({ id: "media-1", path: "https://postiz.example.com/uploads/i.png" });
      if (path === "posts" && init?.method === "POST") return json([{ postId: `post-${++posts}`, integration: "ch-1" }]);
      return json({ error: "unexpected " + path }, 404);
    }),
  );
  return mcp;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Seeded = Awaited<ReturnType<typeof seed>>;
// Run immediate notifications before advancing to their five-minute watchdogs.
async function finishImmediateNotifications(ctx: Seeded) {
  vi.advanceTimersByTime(0);
  await ctx.t.finishInProgressScheduledFunctions();
}
const publish = async (ctx: Seeded) => {
  await ctx.owner.action(api.missions_node.performReviewAction, { missionId: ctx.missionId, actionKey: "publish" });
  await finishImmediateNotifications(ctx);
};
const listed = async (ctx: Seeded) =>
  (await ctx.owner.query(api.publications.listForMission, { missionId: ctx.missionId }))[0];
const missionOf = (ctx: Seeded) => ctx.owner.query(api.missions.get, { missionId: ctx.missionId });

describe("a Publication reaching published", () => {
  it("calls onPublished once, with the Agent's key and the publication placeholders", async () => {
    const ctx = await seed();
    const mcp = fakeServices();

    await publish(ctx);

    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0].url).toBe("https://mcp.example.com/articles/art%207/published");
    expect(mcp.calls[0].headers).toMatchObject({ Authorization: "Bearer agent-key" });
    expect(mcp.calls[0].body).toEqual({ postId: "post-1" });
    expect(await listed(ctx)).toMatchObject({
      status: "published",
      notification: { status: "sent", service: `Fixture ${TEMPLATE_ID}` },
    });
  });

  it("mirrors the indexing outcome on the Mission", async () => {
    const ctx = await seed();
    fakeServices();
    await publish(ctx);
    expect(await missionOf(ctx)).toMatchObject({
      status: "done",
      indexing: { status: "submitted", provider: "speedyindex", taskId: "task-1" },
    });
  });

  it("is not called again when the published Publication is recorded again (a replay)", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    await publish(ctx);

    // The scheduled-post polling fills in a link on an already published Publication.
    await ctx.t.mutation(internal.publications.finish, {
      publicationId: (await listed(ctx)).id,
      status: "published",
      externalUrl: "https://instagram.com/p/x",
    });
    await finishImmediateNotifications(ctx);

    expect(mcp.calls).toHaveLength(1);
  });

  it("waits for the post's link when the call sends it, then calls once with it", async () => {
    const ctx = await seed({ templateId: URL_TEMPLATE_ID });
    const mcp = fakeServices();
    await publish(ctx);
    expect(mcp.calls).toHaveLength(0);
    expect((await missionOf(ctx))?.status).toBe("done");

    const publicationId = (await listed(ctx)).id;
    const linkArrives = () =>
      ctx.t.mutation(internal.publications.finish, { publicationId, status: "published", externalUrl: "https://instagram.com/p/x" });
    await linkArrives();
    await finishImmediateNotifications(ctx);
    await linkArrives();
    await finishImmediateNotifications(ctx);

    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0].body).toEqual({ url: "https://instagram.com/p/x" });
    expect((await listed(ctx)).notification).toMatchObject({ status: "sent", service: "Site Writer" });
  });

  it.each([true, false])("uses the pinned notification declaration after a Template update (V1 notifies: %s)", async (notifies) => {
    const ctx = await seed();
    const mcp = fakeServices();
    const silentVersion = { ...silentTemplate, manifest: { ...silentTemplate.manifest, id: TEMPLATE_ID } };
    setTemplateRegistryForTests(createInMemoryTemplateRegistry([
      { projectId: INSTANCE_ID, template: notifies ? notifyingTemplate : silentVersion, version: "1.0.0" },
      { projectId: INSTANCE_ID, template: notifies ? silentVersion : notifyingTemplate, version: "2.0.0" },
    ]));
    await ctx.t.run(async (c) => c.db.patch(ctx.missionId, { templateVersion: "1.0.0" }));
    await publish(ctx);
    expect(mcp.calls).toHaveLength(notifies ? 1 : 0);
    expect((await missionOf(ctx))?.status).toBe("done");
  });

  it("calls nothing for a Mission type without onPublished", async () => {
    const ctx = await seed({ templateId: PLAIN_TEMPLATE_ID });
    const mcp = fakeServices();
    await publish(ctx);
    expect(mcp.calls).toHaveLength(0);
    expect((await listed(ctx)).notification).toBeUndefined();
  });
});

describe("a failed onPublished call", () => {
  it("leaves the Mission done and the Publication published, with a warning", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({ error: "site is down" }, 503);

    await publish(ctx);

    expect((await missionOf(ctx))?.status).toBe("done");
    const publication = await listed(ctx);
    expect(publication.status).toBe("published");
    expect(publication.notification).toMatchObject({ status: "failed", service: `Fixture ${TEMPLATE_ID}` });
    expect(publication.notification?.error).toContain("503");
  });

  it("can be resent by the owner, and then succeeds", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({ error: "site is down" }, 503);
    await publish(ctx);
    mcp.answer = () => json({ indexing: { status: "skipped" } });

    expect(
      await ctx.owner.action(api.publication_notify_node.resendPublishedNotification, { publicationId: (await listed(ctx)).id }),
    ).toEqual({ ok: true });

    expect(mcp.calls).toHaveLength(2);
    expect((await listed(ctx)).notification).toMatchObject({ status: "sent" });
    expect((await listed(ctx)).notification?.error).toBeUndefined();
    expect((await missionOf(ctx))?.indexing).toEqual({ status: "skipped" });
  });

  it("cannot be resent by someone else", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({}, 500);
    await publish(ctx);
    const publicationId = (await listed(ctx)).id;
    await expect(
      ctx.t.withIdentity(OTHER).action(api.publication_notify_node.resendPublishedNotification, { publicationId }),
    ).rejects.toThrow(/Forbidden/);
    expect(mcp.calls).toHaveLength(1);
  });

  it.each([OWNER.subject, OWNER.tokenIdentifier])("refuses the same subject from a different issuer (owner: %s)", async (ownerId) => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({}, 503);
    await publish(ctx);
    await ctx.t.run(async (c) => c.db.patch(ctx.missionId, { ownerId }));
    const impostor = { ...OWNER, tokenIdentifier: "different-issuer|onp" };
    await expect(ctx.t.withIdentity(impostor).action(api.publication_notify_node.resendPublishedNotification, {
      publicationId: (await listed(ctx)).id,
    })).rejects.toThrow(/Forbidden/);
    expect(mcp.calls).toHaveLength(1);
  });

  it("accepts a canonical token owner on resend", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({}, 503);
    await publish(ctx);
    const publicationId = (await listed(ctx)).id;
    await ctx.t.run(async (c) => c.db.patch(ctx.missionId, { ownerId: OWNER.tokenIdentifier }));
    mcp.answer = () => json({});
    await expect(ctx.owner.action(api.publication_notify_node.resendPublishedNotification, { publicationId }))
      .resolves.toEqual({ ok: true });
    expect(mcp.calls).toHaveLength(2);
  });

  it("persists an interrupted resend as failed at its deadline", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({}, 503);
    await publish(ctx);
    const publicationId = (await listed(ctx)).id;
    await ctx.owner.mutation(internal.publication_notifications.claimResend, { publicationId });
    vi.advanceTimersByTime(NOTIFICATION_ABANDONED_AFTER_MS);
    await ctx.t.finishInProgressScheduledFunctions();
    const publication = await ctx.t.query(internal.publications.getInternal, { publicationId });
    expect(publication?.notification).toMatchObject({ status: "failed", error: "The call did not finish" });
    expect((await missionOf(ctx))?.status).toBe("done");
  });

  it("ignores an expired attempt's watchdog and late result after a newer resend", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    mcp.answer = () => json({}, 503);
    await publish(ctx);
    const publicationId = (await listed(ctx)).id;
    await ctx.owner.mutation(internal.publication_notifications.claimResend, { publicationId });
    const old = await ctx.t.query(internal.publications.getInternal, { publicationId });
    const startedAt = old!.notification!.updatedAt;
    vi.advanceTimersByTime(NOTIFICATION_ABANDONED_AFTER_MS);
    await ctx.owner.mutation(internal.publication_notifications.claimResend, { publicationId });
    await ctx.t.mutation(internal.publication_notifications.expire, { publicationId, startedAt });
    await ctx.t.mutation(internal.publication_notifications.record, { publicationId, startedAt, error: "stale error" });
    const current = await ctx.t.query(internal.publications.getInternal, { publicationId });
    expect(current?.notification).toMatchObject({ status: "sending" });
    expect(current?.notification?.error).toBeUndefined();
    await finishImmediateNotifications(ctx);
  });

  it("shows a call that never finished as failed, and lets it be resent", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    await publish(ctx);
    const publicationId = (await listed(ctx)).id;
    // The action died mid-call: the Publication still says `sending`, long ago.
    await ctx.t.run(async (c) => {
      await c.db.patch(publicationId, { notification: { status: "sending", service: "Fixture", updatedAt: Date.now() - 10 * 60_000 } });
    });
    expect((await listed(ctx)).notification).toMatchObject({ status: "failed", error: "The call did not finish" });

    await ctx.owner.action(api.publication_notify_node.resendPublishedNotification, { publicationId });

    expect(mcp.calls).toHaveLength(2);
    expect((await listed(ctx)).notification).toMatchObject({ status: "sent" });
  });

  it("is not resent while a call is in flight or once it went through", async () => {
    const ctx = await seed();
    const mcp = fakeServices();
    await publish(ctx);
    await expect(
      ctx.owner.action(api.publication_notify_node.resendPublishedNotification, { publicationId: (await listed(ctx)).id }),
    ).rejects.toThrow(/already being sent, or it went through/);
    expect(mcp.calls).toHaveLength(1);
  });
});
