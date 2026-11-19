// Test fixture for Analytics Adapters (ADR-078): what an installed adapter package leaves in the
// database (`kind: "analytics"`, its data in `meta`). Installing from the hub is covered by analytics_hub_chain.test.ts.

import type { convexTest } from "convex-test";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";

export type AnalyticsAdapterData = AnalyticsAdapterMeta;

/** Postiz measures its own posts: it needs the id Postiz gave and works only with the Postiz Publisher. */
export const POSTIZ_ANALYTICS: AnalyticsAdapterData = {
  id: "postiz-analytics",
  name: "Postiz analytics",
  needs: "externalId",
  publisher: "postiz",
  earliestDelayMs: 0,
  options: [{ key: "lookbackDays", label: "Look-back window (days)", type: "number", default: 7, min: 1, max: 90 }],
};
/** A web analytics service: measures a page by its URL, whatever published it. */
export const WEB_ANALYTICS: AnalyticsAdapterData = { id: "web-analytics", name: "Web analytics", needs: "url", earliestDelayMs: 2 * 24 * 3_600_000 };

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
