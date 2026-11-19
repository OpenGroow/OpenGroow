import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";
import { insertInstance } from "./instance_fixture";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// The Analytics page says why it has nothing to list (Seam 1: `analytics.emptyReason`): the dominant
// reason is the first of not opted in, not linked, waiting.

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../instances.ts": () => import("../instances.js"),
  "../publishers.ts": () => import("../publishers.js"),
};

const INSTANCE_ID = "openclaw-empty-reason";
const TEMPLATE_ID = "@test/social";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|er", subject: "er-owner" };
const STRANGER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|zz", subject: "zz-other" };
const DAY = 24 * 3_600_000;

useTemplateRegistry(
  [INSTANCE_ID],
  [
    fixtureTemplate(TEMPLATE_ID, {
      name: "Social Template",
      missionTypes: [
        { type: "make_reel", label: "Reel", payload: "{}", agentsMd: "a.md", publish: { kind: "video" }, analytics: {} },
        { type: "make_note", label: "Note", payload: "{}", agentsMd: "b.md", publish: { kind: "image" } },
      ],
    } as never),
  ],
);

async function seed() {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-er", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-2", channelName: "My TT", channelService: "tiktok", channelProfile: "me" });
  const publish = (opts: { target: string; type?: string; row?: { nextAt: number } }) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: opts.type ?? "make_reel",
        payload: {},
        status: "done",
        createdAt: now,
        updatedAt: now,
      } as never);
      const publicationId = await ctx.db.insert("publications", { missionId, instanceId: INSTANCE_ID, target: opts.target, status: "published", externalId: "p", createdAt: now, updatedAt: now });
      if (opts.row) {
        await ctx.db.insert("publicationAnalytics", {
          publicationId,
          postSeries: 0,
          instanceId: INSTANCE_ID,
          adapter: "postiz-analytics",
          publisherAdapter: "postiz",
          publishedAt: now,
          delays: [DAY],
          taken: 0,
          state: "waiting",
          nextAt: opts.row.nextAt,
          done: false,
          updatedAt: now,
        });
      }
    });
  const reason = (client = owner) => client.query(api.analytics.emptyReason, { instanceId: INSTANCE_ID });
  return { t, owner, publish, reason };
}

describe("analytics.emptyReason", () => {
  it("says none when nothing is published", async () => {
    const s = await seed();
    expect(await s.reason()).toEqual({ reason: "none" });
  });

  it("names the Mission type and the Template when a published post's Mission type declares no analytics", async () => {
    const s = await seed();
    await s.publish({ target: "instagram:me", type: "make_note" });
    expect(await s.reason()).toEqual({ reason: "not_opted_in", missionTypes: ["Note"], templates: ["Social Template"] });
  });

  it("names the channels that are linked to no adapter when the Mission type is opted in", async () => {
    const s = await seed();
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: null });
    await s.publish({ target: "tiktok:me" });
    expect(await s.reason()).toEqual({ reason: "not_linked", channels: ["My TT"], adapterName: POSTIZ_ANALYTICS.name });
  });

  it("counts the linked posts waiting for a first reading with the earliest next reading", async () => {
    const s = await seed();
    const soon = Date.now() + DAY;
    await s.publish({ target: "instagram:me", row: { nextAt: soon + DAY } });
    await s.publish({ target: "instagram:me", row: { nextAt: soon } });
    expect(await s.reason()).toEqual({ reason: "waiting", count: 2, nextAt: soon });
  });

  it("puts not opted in before not linked before waiting", async () => {
    const s = await seed();
    await s.owner.mutation(api.publishers.setAnalyticsLink, { instanceId: INSTANCE_ID, adapter: "postiz", target: "tiktok:me", analyticsAdapter: null });
    await s.publish({ target: "instagram:me", row: { nextAt: Date.now() + DAY } });
    expect((await s.reason()).reason).toBe("waiting");
    await s.publish({ target: "tiktok:me" });
    expect((await s.reason()).reason).toBe("not_linked");
    await s.publish({ target: "instagram:me", type: "make_note" });
    expect((await s.reason()).reason).toBe("not_opted_in");
  });

  it("says none to someone who does not own the Project", async () => {
    const s = await seed();
    await s.publish({ target: "instagram:me", type: "make_note" });
    expect(await s.reason(s.t.withIdentity(STRANGER))).toEqual({ reason: "none" });
  });
});
