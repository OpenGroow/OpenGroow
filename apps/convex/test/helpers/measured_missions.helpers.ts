import type { convexTest } from "convex-test";
import { api } from "../../_generated/api";
import { insertInstance } from "../instance_fixture";
import { installPostiz } from "../postiz_fixture";
import { installAnalyticsAdapter, POSTIZ_ANALYTICS } from "../analytics_fixture";

// Missions with Publications the way analytics sees them, for the tests that need a Mission to be "measured".
// Modules the test must load: publishers.ts and instances.ts.

const DAY = 24 * 3_600_000;
const OWNER = { name: "Owner", email: "o@e.com", tokenIdentifier: "test|measured", subject: "measured-owner" };

type T = ReturnType<typeof convexTest>;

/** A Project with a Publisher whose channel is linked to an Analytics Adapter. Call once per Project. */
export async function seedPublishingProject(t: T, instanceId: string) {
  await t.run(async (ctx) => {
    const iso = new Date().toISOString();
    await insertInstance(ctx, { jobId: `job-${instanceId}`, status: "running", runtimeStatus: "linked", runtimeReady: true, createdAt: iso, openclawId: instanceId, updatedAt: iso, userId: OWNER.tokenIdentifier });
  });
  const hasHub = await t.run((ctx) => ctx.db.query("hubPackages").first());
  if (!hasHub) {
    await installPostiz(t);
    await installAnalyticsAdapter(t, POSTIZ_ANALYTICS);
  }
  const owner = t.withIdentity(OWNER);
  await owner.mutation(api.publishers.save, { instanceId, adapter: "postiz", url: "https://postiz.example.com", apiKey: "secret" });
  await owner.mutation(api.publishers.addChannel, { adapter: "postiz", instanceId, channelId: "ch-1", channelName: "My IG", channelService: "instagram", channelProfile: "me" });
}

/** A Mission with one published Publication; `measured` adds a Snapshot (analytics status "data"). Returns the Mission id. */
export function seedMission(t: T, instanceId: string, options: { status?: "done" | "doing" | "to_validate"; measured?: boolean; publish?: boolean } = {}) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const publishedAt = now - DAY;
    const missionId = await ctx.db.insert("missions", {
      ownerId: "owner", instanceId, templateId: "@example/maker", type: "create_article", name: "Post",
      payload: { topic: "pricing" }, status: options.status ?? "done", number: 7, createdAt: now, updatedAt: now,
    } as never);
    if (options.publish === false) return missionId;
    const publicationId = await ctx.db.insert("publications", { missionId, instanceId, target: "instagram:me", status: "published", externalId: "p", externalUrl: "https://example.com/p/1", createdAt: publishedAt, updatedAt: publishedAt } as never);
    await ctx.db.insert("publicationAnalytics", { publicationId, postSeries: 0, instanceId, adapter: "postiz-analytics", publisherAdapter: "postiz", publishedAt, delays: [DAY], taken: 0, state: "waiting", nextAt: publishedAt + DAY, done: false, updatedAt: now });
    if (options.measured) {
      await ctx.db.insert("performanceSnapshots", { publicationId, postSeries: 0, instanceId, delayMs: DAY, takenAt: now, metrics: { views: 1200 }, adapter: "postiz-analytics", source: "adapter" });
    }
    return missionId;
  });
}
