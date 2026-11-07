import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server.js";
import { kindV } from "./hub_package_kinds.js";

// Storage of the packages installed from the hub (ADR-072). Kind-agnostic.

const filesV = v.array(v.object({ path: v.string(), content: v.string() }));

/** Stores a package, replacing the installed version of the same id (an upgrade), files included. */
export const replace = internalMutation({
  args: {
    packageId: v.string(),
    kind: v.string(),
    version: v.string(),
    tag: v.string(),
    digest: v.string(),
    verification: v.string(),
    files: filesV,
  },
  handler: async (ctx, { files, ...meta }) => {
    const previous = await ctx.db.query("hubPackages").withIndex("by_package_id", (q) => q.eq("packageId", meta.packageId)).unique();
    if (previous) {
      for (const file of await ctx.db.query("hubPackageFiles").withIndex("by_package", (q) => q.eq("hubPackageId", previous._id)).collect()) {
        await ctx.db.delete(file._id);
      }
      await ctx.db.delete(previous._id);
    }
    const id = await ctx.db.insert("hubPackages", { ...meta, installedAt: Date.now() });
    for (const file of files) await ctx.db.insert("hubPackageFiles", { hubPackageId: id, ...file });
    return { previousVersion: previous?.version };
  },
});

/** An installed package with its files, or null. */
export const get = internalQuery({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }) => {
    const pkg = await ctx.db.query("hubPackages").withIndex("by_package_id", (q) => q.eq("packageId", packageId)).unique();
    if (!pkg) return null;
    const files = await ctx.db.query("hubPackageFiles").withIndex("by_package", (q) => q.eq("hubPackageId", pkg._id)).collect();
    return { ...pkg, files: files.map(({ path, content }) => ({ path, content })) };
  },
});

/** What is installed for a kind (no files), for the install UI. */
export const installed = query({
  args: { kind: kindV },
  handler: async (ctx, { kind }) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Authentication required");
    const rows = await ctx.db.query("hubPackages").withIndex("by_kind", (q) => q.eq("kind", kind)).collect();
    return rows.map(({ packageId, version, tag, verification, installedAt }) => ({ packageId, version, tag, verification, installedAt }));
  },
});
