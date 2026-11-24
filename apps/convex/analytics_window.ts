import type { QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { installedAnalyticsAdapters } from "./analytics_adapters.js";
import { channelOf, projectPublishers } from "./project_publishers.js";
import { LIST_LIMIT, publishedOf } from "./analytics.js";

/** The most published Publications the summary reads, newest created first (ADR-084). It bounds the database reads. */
export const SCAN_LIMIT = 2000;

export type PublicationInWindow = {
  publication: Doc<"publications">;
  mission: Doc<"missions">;
  /** The post of the Publication that is current (`postSeries`, 0 when it has no series). */
  series: number;
  publishedAt: number;
  found: ReturnType<typeof channelOf>;
  platform: string;
};

/** The Project's published Publications whose publication date falls in `[from, to]`, each with its Mission and channel. */
export async function publicationsInWindow(ctx: Pick<QueryCtx, "db">, instanceId: string, window: { from: number; to: number }, cap: number = LIST_LIMIT, platformFilter?: string) {
  const publications = await publishedOf(ctx, instanceId, cap);
  const publishers = await projectPublishers(ctx, instanceId);
  const installed = await installedAnalyticsAdapters(ctx);
  const inWindow: PublicationInWindow[] = [];
  for (const publication of publications) {
    const mission = await ctx.db.get(publication.missionId);
    if (!mission) continue;
    const series = publication.postSeries ?? 0;
    const analytics = await ctx.db
      .query("publicationAnalytics")
      .withIndex("by_publication_and_series", (q) => q.eq("publicationId", publication._id).eq("postSeries", series))
      .first();
    const publishedAt = analytics?.publishedAt ?? publication.updatedAt;
    if (publishedAt < window.from || publishedAt > window.to) continue;
    const found = channelOf(publishers, publication.target);
    const platform = found?.channel.channelService ?? publication.target.split(":")[0];
    if (platformFilter !== undefined && platform !== platformFilter) continue;
    inWindow.push({ publication, mission, series, publishedAt, found, platform });
  }
  // A full page may hide older rows; a shorter one is the whole set.
  const scanLimited = publications.length >= cap;
  const oldestScannedCreatedAt = scanLimited ? publications[publications.length - 1]._creationTime : undefined;
  return { inWindow, installed, scanLimited, oldestScannedCreatedAt };
}
