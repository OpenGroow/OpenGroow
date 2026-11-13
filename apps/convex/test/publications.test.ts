import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// Issue #17, ADR-069: the human `publish` action sends the Publishable of an
// `image` Mission through the Project's Publisher and tracks one Publication
// per (Mission, Publish target). Driven through the public Convex functions;
// only Postiz's HTTP is faked.

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
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-publications";
const TEMPLATE_ID = "@test/image-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|pubn", subject: "pubn-owner" };
const OTHER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|pubn-x", subject: "pubn-other" };

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

const IG = { instanceId: INSTANCE_ID, adapter: "postiz", channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "love_youmake" };
const PIN = { instanceId: INSTANCE_ID, adapter: "postiz", channelId: "ch-2", channelName: "My Pin", channelService: "pinterest", channelProfile: "pins", settings: { board: "b1" } };

const PUBLISHABLE = { kind: "image", imageUrl: "https://cdn.example.com/i.png", caption: "Hello world" };

async function seed(opts: { publishable?: Record<string, unknown>; map?: boolean; payload?: Record<string, unknown>; templateId?: string; type?: string } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
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
    await owner.mutation(api.publishers.addChannel, IG);
  } else {
    // A legacy entry without a channel.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("publishers").first();
      await ctx.db.patch(row!._id, { targets: [{ target: "instagram:love_youmake" }] });
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
        artifact: { external: { service: "media", id: "42" }, publishable: opts.publishable ?? PUBLISHABLE },
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
  let uploads = 0;
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace("https://postiz.example.com/api/public/v1/", "");
    if (path === "integrations") return json([{ id: "ch-1", name: "My IG", identifier: "instagram" }, { id: "ch-2", name: "My Pin", identifier: "pinterest" }]);
    if (path === "upload-from-url") {
      const n = ++uploads;
      return json({ id: `media-${n}`, path: `https://postiz.example.com/uploads/${n}` });
    }
    if (path === "posts" && init?.method === "POST") return postsResponse();
    return json({ error: "unexpected " + path }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const postedBody = (fn: ReturnType<typeof stubPostiz>) => {
  const call = fn.mock.calls.find(([url]) => String(url).endsWith("/posts"));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publish an image Mission through the Publisher", () => {
  it("creates a Publication that ends published, sends the post to the mapped channel and completes the Mission", async () => {
    const { owner, missionId } = await seed();
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const publications = await owner.query(api.publications.listForMission, { missionId });
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ target: "instagram:love_youmake", status: "published", externalId: "post-1" });
    const body = postedBody(postiz);
    expect(body.type).toBe("now");
    expect(body.posts[0].integration.id).toBe("ch-1");
    expect(body.posts[0].value[0].content).toBe("Hello world");
    expect(body.posts[0].value[0].image[0]).toMatchObject({ id: "media-1" });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });
});

describe("a failing Publisher", () => {
  it("leaves a failed Publication and an approved Mission, then a retry of the same publish succeeds", async () => {
    const { owner, missionId } = await seed();
    stubPostiz(() => json({ message: "boom" }, 400));

    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/Postiz responded 400/);

    const [failed] = await owner.query(api.publications.listForMission, { missionId });
    expect(failed).toMatchObject({ target: "instagram:love_youmake", status: "failed" });
    expect(failed.error).toContain("400");
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");

    stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    const publications = await owner.query(api.publications.listForMission, { missionId });
    expect(publications).toHaveLength(1);
    expect(publications[0].status).toBe("published");
    expect(publications[0].error).toBeUndefined();
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });
});

describe("Publish target", () => {
  it("is refused, without reaching Postiz, when it is not mapped to a channel", async () => {
    const { owner, missionId } = await seed({ map: false });
    const postiz = stubPostiz();

    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/not configured/);

    expect(postiz).not.toHaveBeenCalled();
    expect(await owner.query(api.publications.listForMission, { missionId })).toEqual([]);
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");
  });

  it("has no default: the human chooses a channel of the Publisher before publishing", async () => {
    const { owner, missionId } = await seed({ payload: {} });
    await owner.mutation(api.publishers.addChannel, { ...PIN, settings: { board: "b1" } });
    const postiz = stubPostiz();
    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/Choose a channel/);
    expect(postiz).not.toHaveBeenCalled();

    await owner.mutation(api.publications.setTargets, { missionId, targets: ["pinterest:pins"] });
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const [publication] = await owner.query(api.publications.listForMission, { missionId });
    expect(publication.target).toBe("pinterest:pins");
    expect(postedBody(postiz).posts[0].settings).toMatchObject({ __type: "pinterest", board: "b1" });
  });

  it("cannot be set to a channel that is not on the Project's Publisher", async () => {
    const { owner, missionId } = await seed();
    await expect(
      owner.mutation(api.publications.setTargets, { missionId, targets: ["tiktok"] }),
    ).rejects.toThrow(/Unknown channel "tiktok"/);
    await expect(
      owner.mutation(api.publications.setTargets, { missionId, targets: ["instagram:love_youmake", "tiktok"] }),
    ).rejects.toThrow(/Unknown channel/);
    const postiz = stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect((await owner.query(api.publications.listForMission, { missionId })).map((p) => p.target)).toEqual(["instagram:love_youmake"]);
    expect(postiz).toHaveBeenCalled();
  });

  it("a later single choice replaces an earlier multiple one (no edit is silently ignored)", async () => {
    const { owner, missionId } = await seed({ payload: {} });
    await owner.mutation(api.publishers.addChannel, { ...PIN, channelId: "ch-2" });
    await owner.mutation(api.publications.setTargets, { missionId, targets: ["instagram:love_youmake", "pinterest:pins"] });
    await owner.mutation(api.publications.setTargets, { missionId, targets: ["pinterest:pins"] });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ targets: ["pinterest:pins"] });
  });

  it("can only be changed by the owner", async () => {
    const { t, missionId } = await seed();
    await expect(
      t.withIdentity(OTHER).mutation(api.publications.setTargets, { missionId, targets: ["instagram:love_youmake"] }),
    ).rejects.toThrow();
  });
});

describe("channel capabilities for the Mission type's kind", () => {
  const YT = { instanceId: INSTANCE_ID, adapter: "postiz", channelId: "ch-3", channelName: "My YT", channelService: "youtube", channelProfile: "yt" };
  const MASTO = { instanceId: INSTANCE_ID, adapter: "postiz", channelId: "ch-4", channelName: "My Masto", channelService: "mastodon", channelProfile: "m" };

  it("refuses a channel that cannot publish the kind when the human chooses targets", async () => {
    const { owner, missionId } = await seed({ payload: {} });
    await owner.mutation(api.publishers.addChannel, YT);
    await expect(
      owner.mutation(api.publications.setTargets, { missionId, targets: ["youtube:yt"] }),
    ).rejects.toThrow(/YouTube cannot publish an image/);
  });

  it("allows an uncertain channel", async () => {
    const { t, owner, missionId } = await seed({ payload: {} });
    // A platform the package declares without saying whether it takes an image: `uncertain`.
    await t.run(async (ctx) => {
      const pkg = (await ctx.db.query("hubPackages").collect()).find((p) => p.provides === "postiz")!;
      const meta = pkg.meta as { capabilities: { platforms: Record<string, unknown> } };
      await ctx.db.patch(pkg._id, {
        meta: { ...meta, capabilities: { ...meta.capabilities, platforms: { ...meta.capabilities.platforms, mastodon: { name: "Mastodon" } } } },
      });
    });
    await owner.mutation(api.publishers.addChannel, MASTO);
    await expect(
      owner.mutation(api.publications.setTargets, { missionId, targets: ["mastodon:m"] }),
    ).resolves.toBeNull();
  });

  it("refuses at publish time, without reaching Postiz", async () => {
    const { owner, missionId } = await seed({ payload: { publishTargets: ["youtube:yt"] } });
    await owner.mutation(api.publishers.addChannel, YT);
    const postiz = stubPostiz();
    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/YouTube cannot publish an image/);
    expect(postiz).not.toHaveBeenCalled();
  });
});

describe("who can publish", () => {
  it("is refused to anyone but the Mission owner (an Agent has no identity here)", async () => {
    const { t, missionId } = await seed();
    stubPostiz();
    await expect(t.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" })).rejects.toThrow();
    await expect(
      t.withIdentity(OTHER).action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("review projection", () => {
  it("reports the Publish target and its Publications, and disables publish when the target is unmapped", async () => {
    const { owner, missionId } = await seed({ map: false });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ targets: ["instagram:love_youmake"], mapped: false });
    const publish = review.actions.find((a) => a.key === "publish");
    expect(publish).toMatchObject({ enabled: false });
    expect(publish?.disabledReason).toMatch(/Publishers page/);
  });

  it("disables publish with 'Choose a channel' when no channel is chosen", async () => {
    const { owner, missionId } = await seed({ payload: {} });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ targets: [], mapped: false });
    expect(review.actions.find((a) => a.key === "publish")).toMatchObject({ enabled: false, disabledReason: "Choose a channel" });
  });

  it("names the unmapped targets in the reason", async () => {
    const { t, owner, missionId } = await seed({ payload: { publishTargets: ["instagram:love_youmake", "pinterest:pins"] } });
    await owner.mutation(api.publishers.addChannel, PIN);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("publishers").first();
      await ctx.db.patch(row!._id, { targets: row!.targets.map((x) => (x.target === "pinterest:pins" ? { target: "pinterest:pins" } : x)) });
    });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ mapped: false, unmappedTargets: ["pinterest:pins"] });
    expect(review.actions.find((a) => a.key === "publish")?.disabledReason).toMatch(/"pinterest:pins".*Publishers page/);
  });

  it("disables publish, and says why, when a chosen channel is on a platform the content has no variant for", async () => {
    const variantsOnly = { kind: "image", caption: "Hello", variants: { instagram: { imageUrl: "https://cdn.example.com/ig.png" } } };
    const { owner, missionId } = await seed({
      publishable: variantsOnly,
      payload: { publishTargets: ["instagram:love_youmake", "pinterest:pins"] },
    });
    await owner.mutation(api.publishers.addChannel, PIN);
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({
      madeFor: ["instagram"],
      unserved: [{ target: "pinterest:pins", reason: "this image was made for instagram only, it has no media for pinterest" }],
    });
    const publish = review.actions.find((a) => a.key === "publish");
    expect(publish).toMatchObject({ enabled: false });
    expect(publish?.disabledReason).toMatch(/Channel "pinterest:pins": this image was made for instagram only.*create the content again/);
  });

  it("keeps publish enabled when every chosen channel has a variant", async () => {
    const variantsOnly = { kind: "image", caption: "Hello", variants: { instagram: { imageUrl: "https://cdn.example.com/ig.png" } } };
    const { owner, missionId } = await seed({ publishable: variantsOnly });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ madeFor: ["instagram"] });
    expect(review.publish).not.toHaveProperty("unserved");
    expect(review.actions.find((a) => a.key === "publish")).toMatchObject({ enabled: true });
  });

  it("disables publish, pointing at the Publishers page, when the Publisher has no API key", async () => {
    const { t, owner, missionId } = await seed();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("publishers").first();
      await ctx.db.patch(row!._id, { apiKey: undefined });
    });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ publisherReady: false });
    const publish = review.actions.find((a) => a.key === "publish");
    expect(publish).toMatchObject({ enabled: false });
    expect(publish?.disabledReason).toMatch(/API key.*Publishers page/);
  });

  it("keeps publish enabled once the target is mapped and lists the Publications", async () => {
    const { owner, missionId } = await seed();
    stubPostiz(() => json({ message: "boom" }, 400));
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }).catch(() => {});
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toMatchObject({ mapped: true, publications: [{ target: "instagram:love_youmake", status: "failed" }] });
    expect(review.actions.find((a) => a.key === "publish")?.enabled).toBe(true);
  });

  it("has no publish section for a Mission type without publish", async () => {
    const { owner, missionId } = await seed({ templateId: "@test/plain", type: "make_plain" });
    const review = await owner.action(api.missions_node.getReview, { missionId });
    expect(review.publish).toBeUndefined();
  });
});

describe("publish a video Mission", () => {
  const VIDEO = { kind: "video", videoUrl: "https://cdn.example.com/big.mp4", title: "T", caption: "Watch" };

  it("hands the video to Postiz by reference, never downloading it in the Convex action", async () => {
    const { owner, missionId } = await seed({ publishable: VIDEO });
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const uploads = postiz.mock.calls.filter(([url]) => String(url).endsWith("/upload-from-url"));
    expect(uploads).toHaveLength(1);
    expect(JSON.parse(String((uploads[0][1] as RequestInit).body))).toEqual({ url: VIDEO.videoUrl });
    expect(postiz.mock.calls.every(([url]) => String(url).startsWith("https://postiz.example.com/"))).toBe(true);
    const post = postedBody(postiz).posts[0];
    expect(post.value[0].content).toBe("Watch");
    expect(post.value[0].image).toEqual([{ id: "media-1", path: "https://postiz.example.com/uploads/1" }]);
    const [publication] = await owner.query(api.publications.listForMission, { missionId });
    expect(publication.status).toBe("published");
  });

  it("applies per-target settings from the Publisher config, not from the Publishable", async () => {
    const { owner, missionId } = await seed({
      publishable: { ...VIDEO, metadata: { privacy_level: "PUBLIC" } },
    });
    await owner.mutation(api.publishers.updateSettings, {
      adapter: "postiz",
      instanceId: INSTANCE_ID,
      target: "instagram:love_youmake",
      settings: { privacy_level: "SELF_ONLY" },
    });
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    expect(postedBody(postiz).posts[0].settings).toMatchObject({ privacy_level: "SELF_ONLY" });
  });
});

describe("channel lookup", () => {
  it("does not re-list the channels when the mapping already knows the channel's service", async () => {
    const { owner, missionId } = await seed();
    const postiz = stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect(postiz.mock.calls.some(([u]) => String(u).endsWith("/integrations"))).toBe(false);
    expect(postedBody(postiz).posts[0].settings).toMatchObject({ __type: "instagram" });
  });
});

describe("publish a carousel Mission", () => {
  it("uploads the slides in order and posts them in that order", async () => {
    const slideUrls = ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png", "https://cdn.example.com/3.png"];
    const { owner, missionId } = await seed({ publishable: { kind: "carousel", slideUrls, caption: "Swipe" } });
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const uploaded = postiz.mock.calls
      .filter(([url]) => String(url).endsWith("/upload-from-url"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).url);
    expect(uploaded).toEqual(slideUrls);
    const value = postedBody(postiz).posts[0].value;
    expect(value).toHaveLength(1);
    expect(value[0].content).toBe("Swipe");
    expect(value[0].image.map((i: { id: string }) => i.id)).toEqual(["media-1", "media-2", "media-3"]);
  });
});

describe("publish to several targets", () => {
  async function twoTargets() {
    const ctxs = await seed({ payload: {} });
    const { owner, missionId } = ctxs;
    await owner.mutation(api.publishers.addChannel, { ...PIN, channelId: "ch-2" });
    await owner.mutation(api.publications.setTargets, { missionId, targets: ["instagram:love_youmake", "pinterest:pins"] });
    return ctxs;
  }

  it("creates one independent Publication per target and completes the Mission when all are published", async () => {
    const { owner, missionId } = await twoTargets();
    const postiz = stubPostiz();

    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });

    const publications = await owner.query(api.publications.listForMission, { missionId });
    expect(publications.map((p) => [p.target, p.status]).sort()).toEqual([
      ["instagram:love_youmake", "published"],
      ["pinterest:pins", "published"],
    ]);
    const posts = postiz.mock.calls.filter(([url, init]) => String(url).endsWith("/posts") && (init as RequestInit)?.method === "POST");
    expect(posts).toHaveLength(2);
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });

  it("keeps the Mission approved when one target fails, and a retry only redoes the failed one", async () => {
    const { owner, missionId } = await twoTargets();
    let calls = 0;
    stubPostiz(() => (++calls === 1 ? json([{ postId: "p-ok" }]) : json({ message: "boom" }, 400)));

    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/Postiz responded 400/);

    const byTarget = Object.fromEntries(
      (await owner.query(api.publications.listForMission, { missionId })).map((p) => [p.target, p.status]),
    );
    expect(byTarget).toEqual({ "instagram:love_youmake": "published", "pinterest:pins": "failed" });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");

    const postiz = stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect(postiz.mock.calls.filter(([url]) => String(url).endsWith("/posts"))).toHaveLength(1);
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });
});

describe("retrying one failed Publication", () => {
  async function twoFailed() {
    const ctx = await seed();
    const { owner, missionId } = ctx;
    await owner.mutation(api.publishers.addChannel, PIN);
    stubPostiz(() => json({ message: "boom" }, 400));
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }).catch(() => {});
    await owner.mutation(api.publications.setTargets, { missionId, targets: ["pinterest:pins"] });
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }).catch(() => {});
    const rows = await owner.query(api.publications.listForMission, { missionId });
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    return { ...ctx, rows };
  }

  it("retries only that Publication, and completes the Mission once all are published", async () => {
    const { owner, missionId, rows } = await twoFailed();
    const instagram = rows.find((r) => r.target === "instagram:love_youmake")!;
    const pinterest = rows.find((r) => r.target === "pinterest:pins")!;

    const postiz = stubPostiz();
    await owner.action(api.publisher_node.retryPublication, { publicationId: instagram.id });
    expect(postiz.mock.calls.filter(([u]) => String(u).endsWith("/posts"))).toHaveLength(1);

    const after = await owner.query(api.publications.listForMission, { missionId });
    expect(after.find((r) => r.target === "instagram:love_youmake")).toMatchObject({ status: "published", externalId: "post-1" });
    expect(after.find((r) => r.target === "pinterest:pins")).toMatchObject({ status: "failed", error: pinterest.error });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("approved");

    await owner.action(api.publisher_node.retryPublication, { publicationId: pinterest.id });
    expect((await owner.query(api.missions.get, { missionId }))?.status).toBe("done");
  });

  it("keeps a readable error when the retry fails again, and refuses foreign or already published Publications", async () => {
    const { t, owner, missionId, rows } = await twoFailed();
    const instagram = rows.find((r) => r.target === "instagram:love_youmake")!;
    stubPostiz(() => json({ message: "still down" }, 400));
    await expect(owner.action(api.publisher_node.retryPublication, { publicationId: instagram.id })).rejects.toThrow(/400/);
    const again = (await owner.query(api.publications.listForMission, { missionId })).find((r) => r.target === "instagram:love_youmake");
    expect(again).toMatchObject({ status: "failed" });
    expect(again?.error).toContain("400");

    await t.run(async (ctx) => ctx.db.patch(missionId, { status: "to_validate" }));
    await expect(owner.action(api.publisher_node.retryPublication, { publicationId: instagram.id })).rejects.toThrow(/approved/);
    await t.run(async (ctx) => ctx.db.patch(missionId, { status: "approved" }));

    stubPostiz();
    await expect(
      t.withIdentity(OTHER).action(api.publisher_node.retryPublication, { publicationId: instagram.id }),
    ).rejects.toThrow("Forbidden");
    await owner.action(api.publisher_node.retryPublication, { publicationId: instagram.id });
    await expect(
      owner.action(api.publisher_node.retryPublication, { publicationId: instagram.id }),
    ).rejects.toThrow(/already published/);
  });

  it("supplies working Postiz defaults per platform without any channel settings", async () => {
    const { owner, missionId } = await seed({
      publishable: { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "c", title: "Hi" },
      payload: { publishTargets: ["tiktok:tok"] },
    });
    await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-3", channelName: "Tik", channelService: "tiktok", channelProfile: "tok" });
    const postiz = stubPostiz();
    await owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" });
    expect(postedBody(postiz).posts[0].settings).toMatchObject({
      __type: "tiktok",
      privacy_level: "PUBLIC_TO_EVERYONE",
      content_posting_method: "DIRECT_POST",
      duet: true,
      stitch: true,
      title: "Hi",
    });
  });

  it("asks for a board when a Pinterest channel has none", async () => {
    const { owner, missionId } = await seed({ payload: { publishTargets: ["pinterest:pins"] } });
    await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-9", channelName: "Pins", channelService: "pinterest", channelProfile: "pins" });
    stubPostiz();
    await expect(
      owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" }),
    ).rejects.toThrow(/Board ID/);
  });
});
