import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import migrationsComponent from "@convex-dev/migrations/test";
import { runToCompletion } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import schema from "../schema";
import { publisherMetaOf } from "../publisher_packages";
import { POSTIZ_DATA_FILES, POSTIZ_META } from "./postiz_fixture";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../migrations.ts": () => import("../migrations.js"),
  "../publisher_packages.ts": () => import("../publisher_packages.js"),
};

const ROW = {
  kind: "publisher",
  version: "1.0.0",
  tag: "publisher-postiz@1.0.0",
  digest: `sha256:${"0".repeat(64)}`,
  verification: "official",
  installedAt: 0,
};

describe("migrations.describeHubPackages", () => {
  it("derives meta and provides from the stored files of a package installed before them", async () => {
    const t = convexTest(schema, modules);
    migrationsComponent.register(t);
    await t.run(async (ctx) => {
      const old = await ctx.db.insert("hubPackages", { ...ROW, packageId: "@opengroow/publisher-postiz" });
      for (const file of POSTIZ_DATA_FILES) await ctx.db.insert("hubPackageFiles", { hubPackageId: old, ...file });
      // Unreadable files: left as it is, reinstalling fixes it.
      const broken = await ctx.db.insert("hubPackages", { ...ROW, packageId: "@opengroow/publisher-broken" });
      await ctx.db.insert("hubPackageFiles", { hubPackageId: broken, path: "manifest.json", content: "{" });
      expect(await publisherMetaOf(ctx, "postiz")).toBeNull();
    });

    await t.run(async (ctx) => {
      await runToCompletion(ctx, components.migrations, internal.migrations.describeHubPackages);
    });

    await t.run(async (ctx) => {
      expect(await publisherMetaOf(ctx, "postiz")).toMatchObject({ adapter: "postiz", name: POSTIZ_META.name, packageId: "@opengroow/publisher-postiz" });
      const broken = (await ctx.db.query("hubPackages").withIndex("by_package_id", (q) => q.eq("packageId", "@opengroow/publisher-broken")).unique())!;
      expect(broken.meta).toBeUndefined();
      expect(broken.provides).toBeUndefined();
    });
  });
});
