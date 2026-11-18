import { v } from "convex/values";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import { internalQuery, type QueryCtx } from "./_generated/server.js";

// The Analytics Adapter layer over the hub packages (ADR-078), like
// publisher_packages.ts for Publishers: it knows what an installed adapter
// declares and which Publish targets it can measure, not how it was installed
// (installing from the hub comes with the adapter packages). A package of kind
// "analytics" leaves its data in `meta` and its id in `provides`.

/**
 * What an installed Analytics Adapter declares, readable without its code (its manifest): id, name, the
 * key it needs, the Publisher it belongs to (its default for that Publisher's channels; an adapter that
 * needs the service's `externalId` works only with it), its earliest delay and the options a Project can set.
 */
export type { AnalyticsAdapterMeta };

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

/**
 * The adapter a channel of `publisherAdapter` is linked to. `stored` is the channel's own choice:
 * a string is a link made by hand, `null` an unlink, absent means the Publisher's own adapter by default.
 */
export function linkedAdapter(
  installed: readonly AnalyticsAdapterMeta[],
  publisherAdapter: string,
  stored: string | null | undefined,
): { adapter: AnalyticsAdapterMeta; isDefault: boolean } | null {
  const own = installed.find((a) => a.publisher === publisherAdapter);
  if (stored === null) return null;
  if (stored === undefined) return own ? { adapter: own, isDefault: true } : null;
  const chosen = installed.find((a) => a.id === stored);
  // A link to an adapter that was removed since reads as no link.
  return chosen && canMeasure(chosen, publisherAdapter) ? { adapter: chosen, isDefault: chosen.id === own?.id } : null;
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
