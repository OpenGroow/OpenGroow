import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

// ADR-074, issue #63: a Publisher whose manifest says `scheduling: false` (GitHub:
// a commit is immediate) cannot take a `publishAt`. The core refuses it on every
// path a date reaches a channel: Mission and Schedule create and edit, the review
// (date or channels), and the publish itself.

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../commands.ts": () => import("../commands.js"),
  "../events.ts": () => import("../events.js"),
  "../instances.ts": () => import("../instances.js"),
  "../missions.ts": () => import("../missions.js"),
  "../missions_node.ts": () => import("../missions_node.js"),
  "../publications.ts": () => import("../publications.js"),
  "../publisher_node.ts": () => import("../publisher_node.js"),
  "../publishers.ts": () => import("../publishers.js"),
  "../runs.ts": () => import("../runs.js"),
  "../schedules.ts": () => import("../schedules.js"),
  "../project_agents.ts": () => import("../project_agents.js"),
};

const INSTANCE_ID = "openclaw-no-scheduling";
const TEMPLATE_ID = "@test/article-maker";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|nosched", subject: "nosched-owner" };
const TARGET = "github:acme/site";
const HOUR = 3_600_000;
const NOT_SCHEDULABLE = /GitHub cannot schedule a post/;

useTemplateRegistry(
  [INSTANCE_ID],
  [
    fixtureTemplate(TEMPLATE_ID, {
      missionTypes: [
        {
          type: "make_article",
          publish: { kind: "article" },
          review: {
            kind: "article",
            service: "workspace",
            actions: [
              { key: "approve", label: "Approve", requiredStatus: "to_validate", transition: "approved" },
              { key: "publish", label: "Publish", requiredStatus: "approved", transition: "done" },
            ],
          },
        },
      ],
    } as never),
  ],
);

const GITHUB_META = {
  adapter: "github",
  name: "GitHub",
  scheduling: false,
  capabilities: { schemaVersion: 1, adapter: "github", platforms: { github: { name: "GitHub", article: "supported" } } },
  channelOptions: { schemaVersion: 1, adapter: "github", platforms: {} },
};

const ARTICLE = {
  kind: "article",
  markdownUrl: "https://mcp.example.com/articles/a1.md",
  coverUrl: "https://mcp.example.com/articles/a1/cover.webp",
  slug: "my-first-post",
  title: "Hello",
  description: "A first post",
};

async function seed(payload: Record<string, unknown> = { publishTargets: [TARGET] }) {
  const t = convexTest(schema, modules);
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
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "github", url: "https://api.github.com", apiKey: "ghp_token" });
  expect(
    await owner.mutation(api.publishers.addChannel, {
      adapter: "github",
      instanceId: INSTANCE_ID,
      channelId: "acme/site",
      channelName: "acme/site",
      channelService: "github",
      channelProfile: "acme/site",
    }),
  ).toBe(TARGET);
  const now = Date.now();
  const missionId = await t.run(async (ctx) =>
    ctx.db.insert("missions", {
      ownerId: OWNER.subject,
      instanceId: INSTANCE_ID,
      templateId: TEMPLATE_ID,
      type: "make_article",
      payload,
      status: "approved",
      lastResult: {
        status: "needs_human_review",
        summary: "Ready",
        reviewQuestions: [],
        artifact: { external: { service: "articles", id: "a1" }, publishable: ARTICLE },
      },
      createdAt: now,
      updatedAt: now,
    } as never),
  );
  return { t, owner, missionId };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishAt on a Publisher that cannot schedule", () => {
  it("is refused when a Mission is created for its channel", async () => {
    const { owner } = await seed();
    const base = { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "make_article" };
    await expect(owner.mutation(api.missions.create, { ...base, payload: { publishTargets: [TARGET], publishAt: Date.now() + HOUR } })).rejects.toThrow(NOT_SCHEDULABLE);
  });

  it("is refused on Schedule create and edit", async () => {
    const { owner } = await seed();
    const base = { instanceId: INSTANCE_ID, templateId: TEMPLATE_ID, type: "make_article", frequency: { unit: "daily" as const, hour: 9, minute: 0 }, timezone: "UTC" };
    await expect(owner.mutation(api.schedules.create, { ...base, payload: { publishTargets: [TARGET], publishAt: Date.now() + HOUR } })).rejects.toThrow(NOT_SCHEDULABLE);
    const { scheduleId } = await owner.mutation(api.schedules.create, { ...base, payload: { publishTargets: [TARGET] } });
    await expect(
      owner.mutation(api.schedules.updatePayload, { scheduleId, payload: { publishTargets: [TARGET], publishAt: Date.now() + HOUR } }),
    ).rejects.toThrow(NOT_SCHEDULABLE);
  });

  it("is refused at review, whether the date or the channel comes second", async () => {
    const { owner, missionId } = await seed();
    await expect(owner.mutation(api.publications.setPublishAt, { missionId, publishAt: Date.now() + HOUR })).rejects.toThrow(NOT_SCHEDULABLE);
    await owner.mutation(api.publications.setPublishAt, { missionId, publishAt: null });

    const dated = await seed({ publishAt: Date.now() + HOUR });
    await expect(dated.owner.mutation(api.publications.setTargets, { missionId: dated.missionId, targets: [TARGET] })).rejects.toThrow(NOT_SCHEDULABLE);
  });

  it("is refused at publish time, before anything is sent", async () => {
    const { owner, missionId } = await seed({ publishTargets: [TARGET], publishAt: Date.now() + HOUR });
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await expect(owner.action(api.missions_node.performReviewAction, { missionId, actionKey: "publish" })).rejects.toThrow(NOT_SCHEDULABLE);
    expect(fetch).not.toHaveBeenCalled();
    expect(await owner.query(api.publications.listForMission, { missionId })).toEqual([]);
  });
});
