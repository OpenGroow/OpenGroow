// Test fixture for Analytics Adapters (ADR-078): what an installed adapter package leaves in the
// database (`kind: "analytics"`, its data in `meta`). Installing from the hub is covered by analytics_hub_chain.test.ts.

import type { convexTest } from "convex-test";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";

export type AnalyticsAdapterData = AnalyticsAdapterMeta;

/** The metrics a social adapter declares, in column order (what Postiz declares). */
export const SOCIAL_METRICS: AnalyticsAdapterData["metrics"] = [
  { key: "views", label: "Views", type: "counter", format: "number" },
  { key: "likes", label: "Likes", type: "counter", format: "number" },
  { key: "comments", label: "Comments", type: "counter", format: "number" },
  { key: "engagement", label: "Engagement", type: "level", format: "percent", derive: { sum: ["likes", "comments", "shares", "saves"], per: "views" } },
  { key: "reach", label: "Reach", type: "counter", format: "number" },
  { key: "shares", label: "Shares", type: "counter", format: "number" },
  { key: "saves", label: "Saves", type: "counter", format: "number" },
];

/** Postiz measures its own posts: it needs the id Postiz gave and works only with the Postiz Publisher. */
export const POSTIZ_ANALYTICS: AnalyticsAdapterData = {
  id: "postiz-analytics",
  name: "Postiz analytics",
  needs: "externalId",
  publisher: "postiz",
  earliestDelayMs: 0,
  metrics: SOCIAL_METRICS,
  primary: "views",
  options: [{ key: "lookbackDays", label: "Look-back window (days)", type: "number", default: 7, min: 1, max: 90 }],
};
/** A web analytics service: measures a page by its URL, whatever published it. */
export const WEB_ANALYTICS: AnalyticsAdapterData = { id: "web-analytics", name: "Web analytics", needs: "url", earliestDelayMs: 2 * 24 * 3_600_000, metrics: SOCIAL_METRICS, primary: "views" };

export async function installAnalyticsAdapter(t: ReturnType<typeof convexTest>, meta: AnalyticsAdapterData) {
  await t.run(async (ctx) => {
    await ctx.db.insert("hubPackages", {
      packageId: `@opengroow/analytics-${meta.id}`,
      kind: "analytics",
      version: "1.0.0",
      tag: `analytics-${meta.id}@1.0.0`,
      digest: `sha256:${"0".repeat(64)}`,
      verification: "official",
      meta,
      provides: meta.id,
      installedAt: Date.now(),
    });
  });
}
