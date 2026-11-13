import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { insertInstance } from "./instance_fixture";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// ADR-075: a Project has several Publishers, at most one per adapter. A channel
// key is unique across them, and each channel goes through its own Publisher.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publication_polling.ts": () => import("../publication_polling.js"),
};

const INSTANCE_ID = "openclaw-multi-publishers";
const OWNER = { name: "Owner", email: "o@example.com", tokenIdentifier: "test|multi-owner", subject: "multi-owner" };

const GITHUB_META = {
  adapter: "github",
  name: "GitHub",
  scheduling: false,
  capabilities: { schemaVersion: 1, adapter: "github", platforms: { github: { name: "GitHub", article: "supported" } } },
  channelOptions: { schemaVersion: 1, adapter: "github", platforms: {} },
};

const POSTIZ = { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "postiz-key" };
const GITHUB = { instanceId: INSTANCE_ID, adapter: "github", url: "https://api.github.com", apiKey: "ghp_token" };
const IG = { instanceId: INSTANCE_ID, adapter: "postiz", channelId: "ig-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" };
const REPO = { instanceId: INSTANCE_ID, adapter: "github", channelId: "acme/site", channelName: "acme/site", channelService: "github", channelProfile: "acme/site" };

async function seed() {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("hubPackages", {
      packageId: "@opengroow/publisher-github",
      kind: "publisher",
      version: "1.0.0",
      tag: "publisher-github@1.0.0",
      digest: `sha256:${"0".repeat(64)}`,
      verification: "official",
      meta: GITHUB_META,
      provides: "github",
      installedAt: Date.now(),
    });
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: `job-${INSTANCE_ID}`, status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.subject });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, POSTIZ);
  await owner.mutation(api.publishers.save, GITHUB);
  return { t, owner };
}

describe("several Publishers per Project", () => {
  it("keeps one Publisher per adapter, each with its own connection and channels", async () => {
    const { owner } = await seed();
    expect(await owner.mutation(api.publishers.addChannel, IG)).toBe("instagram:me");
    expect(await owner.mutation(api.publishers.addChannel, REPO)).toBe("github:acme/site");
    // Saving again updates that adapter's Publisher, never adds a second one.
    await owner.mutation(api.publishers.save, { ...GITHUB, url: "https://github.com" });

    const all = await owner.query(api.publishers.list, { instanceId: INSTANCE_ID });
    expect(all.map((p) => ({ adapter: p.adapter, url: p.url, targets: p.targets.map((x) => x.target) }))).toEqual([
      { adapter: "postiz", url: "https://postiz.example.com", targets: ["instagram:me"] },
      { adapter: "github", url: "https://github.com", targets: ["github:acme/site"] },
    ]);
    expect(JSON.stringify(all)).not.toContain("key");
  });

  it("refuses a channel key another Publisher of the Project already has", async () => {
    const { t, owner } = await seed();
    // A second package publishing to the same platform: the only way two Publishers can produce the same key.
    await t.run(async (ctx) => {
      await ctx.db.insert("hubPackages", {
        packageId: "@opengroow/publisher-mirror",
        kind: "publisher",
        version: "1.0.0",
        tag: "publisher-mirror@1.0.0",
        digest: `sha256:${"1".repeat(64)}`,
        verification: "official",
        meta: { ...GITHUB_META, adapter: "mirror", name: "Mirror" },
        provides: "mirror",
        installedAt: Date.now(),
      });
    });
    await owner.mutation(api.publishers.save, { ...GITHUB, adapter: "mirror" });
    await owner.mutation(api.publishers.addChannel, REPO);
    await expect(owner.mutation(api.publishers.addChannel, { ...REPO, adapter: "mirror", channelId: "other-id" })).rejects.toThrow(
      'A channel "github:acme/site" is already added to this Project',
    );
  });

  it("removes one Publisher and leaves the others", async () => {
    const { owner } = await seed();
    await owner.mutation(api.publishers.remove, { instanceId: INSTANCE_ID, adapter: "postiz" });
    expect((await owner.query(api.publishers.list, { instanceId: INSTANCE_ID })).map((p) => p.adapter)).toEqual(["github"]);
    await expect(owner.mutation(api.publishers.addChannel, IG)).rejects.toThrow("No Publisher configured");
  });

  it("refuses to publish to a channel missing a required option of its package, before anything is created", async () => {
    const { t, owner } = await seed();
    await t.run(async (ctx) => {
      const pkg = (await ctx.db.query("hubPackages").collect()).find((p) => p.provides === "github")!;
      await ctx.db.patch(pkg._id, {
        meta: {
          ...GITHUB_META,
          channelOptions: { schemaVersion: 1, adapter: "github", platforms: { github: [{ key: "articleBaseUrl", label: "URL of the articles", type: "text", required: true }] } },
        },
      });
    });
    await owner.mutation(api.publishers.addChannel, REPO);
    const missionId = await t.run(async (ctx) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: "@test/any",
        type: "make_article",
        payload: { publishTargets: ["github:acme/site"] },
        status: "approved",
        lastResult: {
          status: "needs_human_review",
          summary: "Ready",
          reviewQuestions: [],
          artifact: { external: { service: "articles", id: "a1" }, publishable: { kind: "image", caption: "x", imageUrl: "https://cdn.example.com/a.png" } },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never),
    );
    await expect(t.mutation(internal.publications.beginAll, { missionId })).rejects.toThrow(
      'Channel "github:acme/site": Set URL of the articles on the Publishers page',
    );
    expect(await t.run(async (ctx) => ctx.db.query("publications").collect())).toEqual([]);
    expect((await t.query(internal.publications.reviewState, { missionId })).unmappedTargets).toEqual(["github:acme/site"]);
    await owner.mutation(api.publishers.updateSettings, { instanceId: INSTANCE_ID, adapter: "github", target: "github:acme/site", settings: { articleBaseUrl: "https://acme.example/blog" } });
    expect((await t.query(internal.publications.reviewState, { missionId })).unmappedTargets).toEqual([]);
  });

  it("sends and polls each channel through the Publisher that carries it", async () => {
    const { t, owner } = await seed();
    await owner.mutation(api.publishers.addChannel, IG);
    await owner.mutation(api.publishers.addChannel, REPO);
    const now = Date.now();
    const missionId = await t.run(async (ctx) =>
      ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: "@test/any",
        type: "make_post",
        payload: { publishTargets: ["instagram:me", "github:acme/site"] },
        status: "approved",
        lastResult: {
          status: "needs_human_review",
          summary: "Ready",
          reviewQuestions: [],
          artifact: { external: { service: "workspace", id: "p1" }, publishable: { kind: "image", caption: "Hello", imageUrl: "https://cdn.example.com/a.png" } },
        },
        createdAt: now,
        updatedAt: now,
      } as never),
    );

    const prepared = await t.mutation(internal.publications.beginAll, { missionId });
    expect(prepared.publications.map((p) => [p.target, p.connection])).toEqual([
      ["instagram:me", { adapter: "postiz", url: "https://postiz.example.com", apiKey: "postiz-key" }],
      ["github:acme/site", { adapter: "github", url: "https://api.github.com", apiKey: "ghp_token" }],
    ]);

    for (const p of prepared.publications) {
      await t.mutation(internal.publications.finish, { publicationId: p.publicationId, status: "scheduled", externalId: `ext-${p.target}`, scheduledAt: now - 1 });
    }
    const due = await t.query(internal.publication_polling.dueScheduled, { now });
    expect(due.map((d) => [d.externalId, d.connection.adapter, d.target?.channelId])).toEqual([
      ["ext-instagram:me", "postiz", "ig-1"],
      ["ext-github:acme/site", "github", "acme/site"],
    ]);
  });
});


describe("completion after replacing a removed Publisher", () => {
  it.each(["failed", "uncertain", "scheduled"] as const)("keeps an old %s Publication as history while completing the new targets", async (status) => {
    const { t, owner } = await seed();
    const oldTarget = await owner.mutation(api.publishers.addChannel, REPO);
    const missionId = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@test/any", type: "make_article",
        payload: { publishTargets: [oldTarget] }, status: "approved",
        lastResult: { status: "needs_human_review", summary: "Ready", reviewQuestions: [], artifact: {
          external: { service: "articles", id: "article-1" }, publishable: {
            kind: "article", markdownUrl: "https://cdn.example.com/a.md", coverUrl: "https://cdn.example.com/a.webp",
            slug: "hello", title: "Hello", description: "An article",
          },
        } }, createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("publications", { missionId, instanceId: INSTANCE_ID, target: oldTarget,
        status, error: "Original send did not finish", createdAt: Date.now(), updatedAt: Date.now() });
      return missionId;
    });
    await owner.mutation(api.publishers.remove, { instanceId: INSTANCE_ID, adapter: "github" });
    await owner.mutation(api.publishers.save, GITHUB);
    const replacements = [];
    for (const name of ["new-site", "second-site"]) {
      replacements.push(await owner.mutation(api.publishers.addChannel, {
        ...REPO, channelId: `acme/${name}`, channelProfile: `acme/${name}`,
      }));
    }
    await owner.mutation(api.publications.setTargets, { missionId, targets: replacements });
    const prepared = await t.mutation(internal.publications.beginAll, { missionId });
    await t.mutation(internal.publications.finish, {
      publicationId: prepared.publications[0].publicationId, status: "published", externalId: "first-commit",
    });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("approved");
    await t.mutation(internal.publications.finish, {
      publicationId: prepared.publications[1].publicationId, status: "published", externalId: "second-commit",
    });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("done");
    const history = await owner.query(api.publications.listForMission, { missionId });
    expect(history).toHaveLength(3);
    expect(history.find((p) => p.target === oldTarget)).toMatchObject({ status, error: "Original send did not finish" });
  });

  it("completes when the last failed destination is deselected and the remaining one is already published", async () => {
    const { t, owner } = await seed();
    const first = await owner.mutation(api.publishers.addChannel, REPO);
    const second = await owner.mutation(api.publishers.addChannel, { ...REPO, channelId: "acme/second", channelProfile: "acme/second" });
    const missionId = await t.run(async (ctx) => {
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject, instanceId: INSTANCE_ID, templateId: "@test/any", type: "make_article",
        payload: { publishTargets: [first, second] }, status: "approved", createdAt: Date.now(), updatedAt: Date.now(),
      });
      for (const [target, status] of [[first, "failed"], [second, "published"]] as const) {
        await ctx.db.insert("publications", { missionId, instanceId: INSTANCE_ID, target,
          status, createdAt: Date.now(), updatedAt: Date.now() });
      }
      return missionId;
    });
    await owner.mutation(api.publications.setTargets, { missionId, targets: [second] });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe("done");
    expect(await owner.query(api.publications.listForMission, { missionId })).toHaveLength(2);
  });
});
