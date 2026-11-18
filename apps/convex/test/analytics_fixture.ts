// Test fixture for Analytics Adapters (ADR-078): what an installed adapter package leaves in the
// database (`kind: "analytics"`, its data in `meta`). Installing from the hub comes with #93.

import type { convexTest } from "convex-test";

export type AnalyticsAdapterData = { id: string; name: string; needs: "externalId" | "url"; publisher?: string };

/** Postiz measures its own posts: it needs the id Postiz gave and works only with the Postiz Publisher. */
export const POSTIZ_ANALYTICS: AnalyticsAdapterData = { id: "postiz-analytics", name: "Postiz analytics", needs: "externalId", publisher: "postiz" };
/** A web analytics service: measures a page by its URL, whatever published it. */
export const WEB_ANALYTICS: AnalyticsAdapterData = { id: "web-analytics", name: "Web analytics", needs: "url" };

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
