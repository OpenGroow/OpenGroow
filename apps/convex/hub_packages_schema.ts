import { defineTable } from "convex/server";
import { v } from "convex/values";

// Hub packages that are not Templates (ADR-072), installed deployment-wide from
// the hub. This layer knows a package's `kind` and its files, nothing about
// what a kind does with them: each kind reads its own files back (a Publisher
// package: publisher/package_store.ts) and validates them at install
// (hub_package_kinds.ts).
export const hubPackageTables = {
  hubPackages: defineTable({
    /** Scoped id of the hub entry (`@opengroow/publisher-postiz`). */
    packageId: v.string(),
    kind: v.string(),
    version: v.string(),
    tag: v.string(),
    /** `sha256:` of the release asset, as verified at install. */
    digest: v.string(),
    verification: v.string(),
    /**
     * What queries and the dashboard need from the package without reading its
     * files, derived at install by the kind (hub_package_kinds.ts `describe`).
     */
    meta: v.optional(v.any()),
    /** The id the kind looks the package up by (a Publisher: its adapter id), indexed so a lookup reads one row. */
    provides: v.optional(v.string()),
    installedAt: v.number(),
  })
    .index("by_package_id", ["packageId"])
    .index("by_kind", ["kind"])
    .index("by_kind_provides", ["kind", "provides"]),

  // One row per file, like `templateFiles`: bounded by the package, each well under the document limit.
  hubPackageFiles: defineTable({
    hubPackageId: v.id("hubPackages"),
    path: v.string(),
    content: v.string(),
  }).index("by_package", ["hubPackageId"]),
};
