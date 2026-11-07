import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server.js";
import type { PublisherMeta } from "./hub_package_kinds.js";

// The Publisher layer over the hub packages (ADR-072): it knows what a
// Publisher package is, not how it was installed. Queries and mutations read
// the data derived at install (`meta`); the code (the bundle) is only read by
// Node actions, through `bundleOf`.

/** The installed Publisher packages' data; `packageId` is the hub entry that provides each. */
export async function installedPublishers(ctx: Pick<QueryCtx, "db">): Promise<Array<PublisherMeta & { packageId: string; version: string }>> {
  const rows = await ctx.db.query("hubPackages").withIndex("by_kind", (q) => q.eq("kind", "publisher")).collect();
  return rows.flatMap((row) => (row.meta ? [{ ...(row.meta as PublisherMeta), packageId: row.packageId, version: row.version }] : []));
}

/** The data of the installed Publisher whose adapter id is `adapter`, or null when none is installed. */
export async function publisherMetaOf(ctx: Pick<QueryCtx, "db">, adapter: string): Promise<PublisherMeta | null> {
  return (await installedPublishers(ctx)).find((p) => p.adapter === adapter) ?? null;
}

/** Throws when no installed package provides `adapter`: a Publisher cannot be saved or used without its package. */
export async function requirePublisherMeta(ctx: Pick<QueryCtx, "db">, adapter: string): Promise<PublisherMeta> {
  const meta = await publisherMetaOf(ctx, adapter);
  if (!meta) throw new Error(`The Publisher "${adapter}" is not installed`);
  return meta;
}

/** For the dashboard: what each installed Publisher offers (no code). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Authentication required");
    return await installedPublishers(ctx);
  },
});

/** For Node actions: the bundle of the installed Publisher `adapter`, with the data it was installed with. */
export const bundleOf = internalQuery({
  args: { adapter: v.string() },
  handler: async (ctx, { adapter }) => {
    const rows = await ctx.db.query("hubPackages").withIndex("by_kind", (q) => q.eq("kind", "publisher")).collect();
    const row = rows.find((r) => (r.meta as PublisherMeta | undefined)?.adapter === adapter);
    if (!row) return null;
    const files = await ctx.db.query("hubPackageFiles").withIndex("by_package", (q) => q.eq("hubPackageId", row._id)).collect();
    const bundle = files.find((f) => f.path === "dist/plugin.mjs");
    const manifest = files.find((f) => f.path === "manifest.json");
    if (!bundle || !manifest) return null;
    return { packageId: row.packageId, digest: row.digest, source: bundle.content, manifest: manifest.content };
  },
});
