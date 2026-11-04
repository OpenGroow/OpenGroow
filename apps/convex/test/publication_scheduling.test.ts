import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// Issue #19, ADR-069: an optional `publishAt` on a Mission schedules the post in
// Postiz (Publication `scheduled`); Convex polls the adapter and moves it to
// `published`. Public Convex functions only; Postiz HTTP is faked.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../runs.ts": () => import("../runs.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-pub-schedule";
const TEMPLATE_ID = "@test/image-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|pubs", subject: "pubs-owner" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|pubs-x", subject: "pubs-other" };

const imageTemplate = fixtureTemplate(TEMPLATE_ID, {
  missionTypes: [
    {
      type: "make_image",
      publish: { kind: "image", targets: ["instagram", "pinterest:recipes"] },
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
  await owner.mutation(api.publishers.addTarget, { instanceId: INSTANCE_ID, target: "instagram" });
  if (opts.map !== false) {
    await owner.mutation(api.publishers.mapTarget, { instanceId: INSTANCE_ID, target: "instagram", channelId: "ch-1" });
  }
  const now = Date.now();
  const missionId = await t.run(async (ctx) =>
    ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: opts.templateId ?? TEMPLATE_ID,
      type: opts.type ?? "make_image",
      payload: opts.payload ?? { publishTarget: "instagram" },
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

/** A fake Postiz. `postsResponse` answers `POST /posts`. */
function stubPostiz(postsResponse: () => Response = () => json([{ postId: "post-1", integration: "ch-1" }])) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace("https://postiz.example.com/public/v1/", "");
    if (path === "integrations") return json([{ id: "ch-1", name: "My IG", identifier: "instagram" }]);
    if (path === "upload-from-url") return json({ id: "media-1", path: "https://postiz.example.com/uploads/i.png" });
    if (path === "posts" && init?.method === "POST") return postsResponse();
    return json({ error: "unexpected " + path }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
/** Adds Postiz's `GET /posts` listing (the poll) on top of the base fake. */
function stubPostizListing(state: string | (() => Response), extra: Record<string, unknown> = {}) {
  const base = stubPostiz();
  const listing = vi.fn(async (url: unknown) => {
    void url;
    return typeof state === "function"
      ? state()
      : json({ posts: [{ id: "post-1", state, publishDate: new Date().toISOString(), ...extra }] });
  });
  vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) =>
    String(url).includes("/public/v1/posts?") && !init?.method ? listing(url) : base(url, init),
  );
  return listing;
}

const postedBody = (fn: ReturnType<typeof stubPostiz>) => {
  const call = fn.mock.calls.find(([url]) => String(url).endsWith("/posts"));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

afterEach(() => {
  vi.unstubAllGlobals();
});


const HOUR = 3_600_000;

describe("publishAt", () => {
  it("without publishAt publishes immediately", async () => {
    const { owner, missionId } = await seed();
    const postiz = stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect(postedBody(postiz).type).toBe("now");
    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p.status).toBe("published");
  });

  it("with a future publishAt yields a scheduled Publication and a schedule post in Postiz", async () => {
    const publishAt = Date.now() + 2 * HOUR;
    const { owner, missionId } = await seed({ payload: { publishTarget: "instagram", publishAt } });
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const body = postedBody(postiz);
    expect(body.type).toBe("schedule");
    expect(body.date).toBe(new Date(publishAt).toISOString());
    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p).toMatchObject({ status: "scheduled", externalId: "post-1", scheduledAt: publishAt });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");
  });
});

describe("polling a scheduled Publication", () => {
  async function scheduled() {
    const ctx = await seed({ payload: { publishTarget: "instagram", publishAt: Date.now() + 2 * HOUR } });
    stubPostiz();
    await ctx.owner.action(api.missions_node.performReviewAction, { missionId: ctx.missionId, actionKey: "publish" });
    return ctx;
  }
  const makeDue = (t: Awaited<ReturnType<typeof seed>>["t"]) =>
    t.run(async (ctx) => {
      for (const p of await ctx.db.query("publications").collect()) await ctx.db.patch(p._id, { scheduledAt: Date.now() - 1000 });
    });

  it("moves it to published and completes the Mission once Postiz has published the post", async () => {
    const { t, owner, missionId } = await scheduled();
    await makeDue(t);
    stubPostizListing("PUBLISHED", { releaseURL: "https://instagram.com/p/abc" });

    await t.action(internal.publications.pollScheduled, {});

    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p).toMatchObject({ status: "published", externalUrl: "https://instagram.com/p/abc" });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });

  it("leaves it scheduled while Postiz still has the post queued", async () => {
    const { t, owner, missionId } = await scheduled();
    await makeDue(t);
    stubPostizListing("QUEUE");
    await t.action(internal.publications.pollScheduled, {});
    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p.status).toBe("scheduled");
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");
  });

  it("does not call Postiz before the scheduled date", async () => {
    const { t } = await scheduled();
    const listing = stubPostizListing("PUBLISHED");
    await t.action(internal.publications.pollScheduled, {});
    expect(listing).not.toHaveBeenCalled();
  });

  it("keeps it scheduled when Postiz cannot be reached", async () => {
    const { t, owner, missionId } = await scheduled();
    await makeDue(t);
    stubPostizListing(() => json({}, 503));
    await t.action(internal.publications.pollScheduled, {});
    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p.status).toBe("scheduled");
  });

  it("marks it failed with Postiz's error state", async () => {
    const { t, owner, missionId } = await scheduled();
    await makeDue(t);
    stubPostizListing("ERROR");
    await t.action(internal.publications.pollScheduled, {});
    const [p] = await owner.query(api.publications.listForMission, { missionId });
    expect(p.status).toBe("failed");
    expect(p.error).toBeTruthy();
  });
});
