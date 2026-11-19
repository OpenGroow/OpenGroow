import { v } from "convex/values";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import { internalQuery, type QueryCtx } from "./_generated/server.js";

// The Analytics Adapter layer over the hub packages (ADR-078), like
// publisher_packages.ts for Publishers: it knows what an installed adapter
// declares and which Publish targets it can measure, not how it was installed
// (installing from the hub comes with the adapter packages). A package of kind
// "analytics" leaves its data in `meta` and its id in `provides`.

type Ctx = Pick<QueryCtx, "db">;

/** More installed Analytics Adapters than this is not expected. */
const MAX_ADAPTERS = 200;
const MAX_PACKAGE_FILES = 100;

/** The installed Analytics Adapters, ordered by id. */
export async function installedAnalyticsAdapters(ctx: Ctx): Promise<AnalyticsAdapterMeta[]> {
  const rows = await ctx.db.query("hubPackages").withIndex("by_kind", (q) => q.eq("kind", "analytics")).take(MAX_ADAPTERS);
  return rows.flatMap((row) => (row.meta ? [row.meta as AnalyticsAdapterMeta] : [])).sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether `adapter` can measure the channels of the Publisher `publisherAdapter`. */
export function canMeasure(adapter: AnalyticsAdapterMeta, publisherAdapter: string): boolean {
  // An adapter that needs the id of a service only works with that service.
  return adapter.needs !== "externalId" || adapter.publisher === publisherAdapter;
}

/** What a channel's link holds: a string (one link by hand), a list (several), `null` (unlinked) or absent (the Publisher's own adapter). */
export type StoredLink = string | string[] | null | undefined;

/**
 * The adapters a channel of `publisherAdapter` is linked to, the first being the default shown.
 * An adapter that was removed since, or that cannot measure the channel, reads as no link.
 */
export function linkedAdapters(
  installed: readonly AnalyticsAdapterMeta[],
  publisherAdapter: string,
  stored: StoredLink,
): Array<{ adapter: AnalyticsAdapterMeta; isDefault: boolean }> {
  const own = installed.find((a) => a.publisher === publisherAdapter);
  if (stored === null) return [];
  if (stored === undefined) return own ? [{ adapter: own, isDefault: true }] : [];
  const ids = typeof stored === "string" ? [stored] : stored;
  return ids.flatMap((id) => {
    const chosen = installed.find((a) => a.id === id);
    return chosen && canMeasure(chosen, publisherAdapter) ? [{ adapter: chosen, isDefault: chosen.id === own?.id }] : [];
  });
}

/** The first adapter a channel is linked to, or null: what a reading made before several links belongs to. */
export function linkedAdapter(installed: readonly AnalyticsAdapterMeta[], publisherAdapter: string, stored: StoredLink) {
  return linkedAdapters(installed, publisherAdapter, stored)[0] ?? null;
}

/** For Node actions: the bundle of the installed Analytics Adapter `adapter`. */
export const bundleOf = internalQuery({
  args: { adapter: v.string() },
  handler: async (ctx, { adapter }) => {
    const row = await ctx.db.query("hubPackages").withIndex("by_kind_provides", (q) => q.eq("kind", "analytics").eq("provides", adapter)).unique();
    if (!row) return null;
    const files = await ctx.db
      .query("hubPackageFiles")
      .withIndex("by_package", (q) => q.eq("hubPackageId", row._id))
      .take(MAX_PACKAGE_FILES);
    const bundle = files.find((f) => f.path === "dist/plugin.mjs");
    return bundle ? { packageId: row.packageId, digest: row.digest, source: bundle.content } : null;
  },
});
