import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { installPostiz } from "./postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "./analytics_fixture";
import { insertInstance } from "./instance_fixture";
import type { Id } from "../_generated/dataModel";
import { fixtureTemplate, useTemplateRegistry } from "./helpers/template_registry.helpers";

// ADR-078, issue #94: the Analytics page lists a Project's Publications with
// what the page needs to show and rank them. Driven through the public query
// (Seam 1); the Convex rows are what an Analytics Adapter's readings leave.

vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../analytics.ts": () => import("../analytics.js"),
  "../instances.ts": () => import("../instances.js"),
  "../publishers.ts": () => import("../publishers.js"),
};

const INSTANCE_ID = "openclaw-analytics-list";
const TEMPLATE_ID = "@test/social";
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|al", subject: "al-owner" };
const STRANGER = { name: "Other", email: "x@e.com", tokenIdentifier: "test|zz", subject: "zz-other" };
const DAY = 24 * 3_600_000;

useTemplateRegistry(
  [INSTANCE_ID],
  [
    fixtureTemplate(TEMPLATE_ID, {
      missionTypes: [
        { type: "make_reel", label: "Reel", payload: "{}", agentsMd: "a.md", publish: { kind: "video" }, analytics: {} },
        { type: "make_note", label: "Note", payload: "{}", agentsMd: "b.md", publish: { kind: "image" } },
      ],
    } as never),
  ],
);

async function seed(options: { adapter?: boolean } = {}) {
  const t = convexTest(schema, modules);
  await installPostiz(t);
  if (options.adapter !== false) await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  await t.run(async (ctx) => {
    const now = new Date().toISOString();
    await insertInstance(ctx, { jobId: "job-al", status: "running", createdAt: now, openclawId: INSTANCE_ID, updatedAt: now, userId: OWNER.tokenIdentifier });
  });
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId: INSTANCE_ID, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId: INSTANCE_ID, channelId: "ch-2", channelName: "My TT", channelService: "tiktok", channelProfile: "me" });
  const publish = (opts: {
    target: string;
    type?: string;
    status?: "published" | "failed";
    name?: string;
    publishable?: Record<string, unknown>;
    postSeries?: number;
    recipe?: { id: Id<"productionRecipes">; name: string; version: number };
    publishedAt?: number;
    state?: "unmeasured" | "waiting" | "no_data" | "failed" | "post_unknown" | "complete";
    reason?: string;
    done?: boolean;
    snapshots?: Array<{ delayMs: number; metrics: Record<string, number>; postSeries?: number }>;
  }) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const missionId = await ctx.db.insert("missions", {
        ownerId: OWNER.subject,
        instanceId: INSTANCE_ID,
        templateId: TEMPLATE_ID,
        type: opts.type ?? "make_reel",
        payload: {},
        status: "done",
        number: 1,
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.recipe ? { recipeSnapshot: { recipeId: opts.recipe.id, recipeName: opts.recipe.name, version: opts.recipe.version, instructions: "i", constraints: [] } } : {}),
        ...(opts.publishable ? { lastArtifact: { publishable: opts.publishable } } : {}),
        createdAt: now,
        updatedAt: now,
      } as never);
      const publicationId = await ctx.db.insert("publications", {
        missionId,
        instanceId: INSTANCE_ID,
        target: opts.target,
        status: opts.status ?? "published",
        externalId: "p",
        ...(opts.postSeries ? { postSeries: opts.postSeries } : {}),
        createdAt: now,
        updatedAt: now,
      });
      if (opts.state) {
        await ctx.db.insert("publicationAnalytics", {
          publicationId,
          postSeries: opts.postSeries ?? 0,
          instanceId: INSTANCE_ID,
          // An unmeasured row has no adapter to read through.
          ...(opts.state === "unmeasured" ? {} : { adapter: "postiz-analytics" }),
          publisherAdapter: "postiz",
          publishedAt: opts.publishedAt ?? now,
          delays: [DAY, 3 * DAY, 7 * DAY],
          taken: opts.snapshots?.length ?? 0,
          state: opts.state,
          ...(opts.reason ? { reason: opts.reason } : {}),
          nextAt: now + 3 * DAY,
          done: opts.done ?? false,
          updatedAt: now,
        });
      }
      for (const s of opts.snapshots ?? []) {
        await ctx.db.insert("performanceSnapshots", {
          publicationId,
          postSeries: s.postSeries ?? opts.postSeries ?? 0,
          instanceId: INSTANCE_ID,
          delayMs: s.delayMs,
          takenAt: now + s.delayMs,
          metrics: s.metrics,
          adapter: "postiz-analytics",
          source: "adapter",
        });
      }
      return publicationId;
    });
  const list = (filters: { recipeId?: string; familyId?: string; from?: number; to?: number } = {}) => owner.query(api.analytics.listForProject, { instanceId: INSTANCE_ID, ...filters });
  const recipe = (familyName: string, name: string) =>
    t.run(async (ctx) => {
      const creativeFamilyId = await ctx.db.insert("creativeFamilies", { instanceId: INSTANCE_ID, slug: familyName.toLowerCase(), name: familyName, description: "d" });
      const id = await ctx.db.insert("productionRecipes", { instanceId: INSTANCE_ID, creativeFamilyId, templateId: TEMPLATE_ID, missionType: "make_reel", name, description: "d", status: "active" } as never);
      return { id, familyId: creativeFamilyId, name, version: 2 };
    });
  return { t, owner, publish, list, recipe };
}

describe("analytics.listForProject", () => {
  it("lists a Publication with its platform, channel, Mission, ranking metric, state, next reading and Snapshots", async () => {
    const s = await seed();
    await s.publish({
      target: "instagram:me",
      name: "Spring reel",
      state: "waiting",
      snapshots: [
        { delayMs: DAY, metrics: { views: 100, likes: 3 } },
        { delayMs: 3 * DAY, metrics: { views: 250, likes: 9 } },
      ],
    });
    const [row] = await s.list();
    expect(row).toMatchObject({
      platform: "instagram",
      target: "instagram:me",
      channelName: "My IG",
      channelProfile: "me",
      publisherAdapter: "postiz",
      missionName: "Spring reel",
      missionType: "make_reel",
      primaryMetric: "views",
      state: "waiting",
    });
    expect(typeof row.nextAt).toBe("number");
    expect(row.snapshots.map((x) => x.metrics.views)).toEqual([100, 250]);
  });

  it("leaves out a Publication that is not measured: a Mission type that opts out, or no reading scheduled", async () => {
    const s = await seed();
    await s.publish({ target: "tiktok:me", type: "make_note" });
    await s.publish({ target: "instagram:me", state: "unmeasured" });
    await s.publish({ target: "instagram:me", state: "waiting" });
    const rows = await s.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("waiting");
  });

  it("carries the reason of a failed reading and of an unknown post, keeping the earlier Snapshots", async () => {
    const s = await seed();
    await s.publish({ target: "instagram:me", state: "failed", reason: "Service answered 500" });
    await s.publish({ target: "instagram:me", state: "post_unknown", reason: "Post not found at the service", done: true, snapshots: [{ delayMs: DAY, metrics: { views: 7 } }] });
    const rows = await s.list();
    expect(rows.find((r) => r.state === "failed")).toMatchObject({ reason: "Service answered 500" });
    const unknown = rows.find((r) => r.state === "post_unknown");
    expect(unknown).toMatchObject({ reason: "Post not found at the service" });
    expect(unknown?.nextAt).toBeUndefined();
    expect(unknown?.snapshots).toHaveLength(1);
  });

  it("shows the post by its title, its kind and the image of its Publishable", async () => {
    const s = await seed();
    await s.publish({
      target: "instagram:me",
      state: "waiting",
      publishable: { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", coverUrl: "https://cdn.example.com/c.jpg", title: "5 simple rituals", caption: "c" },
    });
    await s.publish({ target: "instagram:me", state: "waiting" });
    const rows = await s.list();
    expect(rows.find((r) => r.title)).toMatchObject({ title: "5 simple rituals", kind: "video", thumbnailUrl: "https://cdn.example.com/c.jpg" });
    expect(rows.filter((r) => !r.thumbnailUrl)).toHaveLength(1);
  });

  it("gives the video of a post with no cover, so the page can show its first frame", async () => {
    const s = await seed();
    await s.publish({ target: "instagram:me", state: "waiting", publishable: { kind: "video", videoUrl: "https://cdn.example.com/v.mp4", caption: "c" } });
    const [row] = await s.list();
    expect(row.thumbnailUrl).toBeUndefined();
    expect(row.videoUrl).toBe("https://cdn.example.com/v.mp4");
  });

  it("leaves out Publications that are not published, and shows nothing to someone else", async () => {
    const s = await seed();
    await s.publish({ target: "instagram:me", status: "failed" });
    expect(await s.list()).toEqual([]);
    await s.publish({ target: "instagram:me", state: "waiting" });
    expect(await s.list()).toHaveLength(1);
    expect(await s.t.withIdentity(STRANGER).query(api.analytics.listForProject, { instanceId: INSTANCE_ID })).toEqual([]);
  });
});

describe("analytics.listForProject attribution (ADR-084)", () => {
  it("gives each Publication the recipe, version and family of its Mission's snapshot, and none when unattributed", async () => {
    const s = await seed();
    const r = await s.recipe("Reaction", "Close-up");
    await s.publish({ target: "instagram:me", state: "waiting", name: "A", recipe: r });
    await s.publish({ target: "instagram:me", state: "waiting", name: "B" });
    const rows = await s.list();
    expect(rows.find((x) => x.missionName === "A")?.attribution).toEqual({ recipeId: r.id, recipeName: "Close-up", version: 2, familyId: r.familyId, familyName: "Reaction" });
    expect(rows.find((x) => x.missionName === "B")?.attribution).toBeUndefined();
  });

  it("narrows to a recipe, a family or a period, leaving out unattributed Publications when a recipe or family is asked", async () => {
    const s = await seed();
    const a = await s.recipe("Reaction", "Close-up");
    const b = await s.recipe("Tutorial", "Steps");
    const now = Date.now();
    await s.publish({ target: "instagram:me", state: "waiting", name: "A", recipe: a });
    await s.publish({ target: "instagram:me", state: "waiting", name: "B", recipe: b, publishedAt: now - 40 * DAY });
    await s.publish({ target: "instagram:me", state: "waiting", name: "C" });
    const names = async (f: Parameters<typeof s.list>[0]) => (await s.list(f)).map((x) => x.missionName).sort();
    expect(await names({ recipeId: a.id })).toEqual(["A"]);
    expect(await names({ familyId: b.familyId })).toEqual(["B"]);
    expect(await names({ from: now - 7 * DAY, to: now + DAY })).toEqual(["A", "C"]);
  });
});

describe("analytics.unavailableForProject", () => {
  it("lists the Publications whose channel has no Analytics Adapter, so the page reads 'analytics unavailable' rather than 'no data yet'", async () => {
    const s = await seed({ adapter: false });
    await s.publish({ target: "instagram:me", state: "unmeasured", reason: "No Analytics Adapter is linked to this channel", name: "Unlinked reel" });
    await s.publish({ target: "tiktok:me", state: "waiting" });
    await s.publish({ target: "tiktok:me", type: "make_note" });
    const rows = await s.owner.query(api.analytics.unavailableForProject, { instanceId: INSTANCE_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "instagram", channelName: "My IG", missionName: "Unlinked reel", reason: "No Analytics Adapter is linked to this channel" });
    expect(await s.t.withIdentity(STRANGER).query(api.analytics.unavailableForProject, { instanceId: INSTANCE_ID })).toEqual([]);
  });
});

describe("analytics.adaptersForProject", () => {
  it("gives the adapter the Project's channels are linked to with its metrics and ranking metric, to the owner only", async () => {
    const s = await seed({ adapter: false });
    const metrics = [
      { key: "clicks", label: "Clicks", type: "counter" as const, format: "number" as const },
      { key: "position", label: "Position", type: "level" as const, format: "number" as const, better: "lower" as const },
    ];
    await installAnalyticsAdapter(s.t, { id: "postiz-v2", name: "Postiz v2", needs: "externalId", publisher: "postiz", earliestDelayMs: 0, metrics, primary: "clicks" });
    const adapters = (who = s.owner) => who.query(api.analytics.adaptersForProject, { instanceId: INSTANCE_ID });
    expect(await adapters()).toEqual([{ adapter: "postiz-v2", name: "Postiz v2", metrics, primary: "clicks" }]);
    expect(await adapters(s.t.withIdentity(STRANGER))).toEqual([]);
  });
});
