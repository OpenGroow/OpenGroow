import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { installedPublishers, publisherMetaOf, requirePublisherMeta } from "../publisher_packages";
import { installPostiz, POSTIZ_META } from "./postiz_fixture";

const modules = {
  "../_generated/api.ts": () => import("../_generated/api.js"),
  "../publisher_packages.ts": () => import("../publisher_packages.js"),
};
const USER = { name: "U", email: "u@e.com", tokenIdentifier: "test|pp", subject: "user-pp" };

describe("installed Publisher packages", () => {
  it("serves the data of what is installed, to the dashboard, without code", async () => {
    const t = convexTest(schema, modules);
    await installPostiz(t);
    const list = await t.withIdentity(USER).query(api.publisher_packages.list, {});
    expect(list).toEqual([expect.objectContaining({ adapter: "postiz", name: "Postiz", packageId: "@opengroow/publisher-postiz", version: "1.0.0" })]);
    expect(list[0]).toHaveProperty("capabilities");
    expect(list[0]).toHaveProperty("channelOptions");
    expect(list[0]).not.toHaveProperty("source");
    expect(list[0]).not.toHaveProperty("files");
  });

  it("requires a signed-in user", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.publisher_packages.list, {})).rejects.toThrow(/Authentication required/);
  });

  it("finds a Publisher's data by adapter id, and refuses one that is not installed", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      expect(await publisherMetaOf(ctx, "postiz")).toBeNull();
      await expect(requirePublisherMeta(ctx, "postiz")).rejects.toThrow('The Publisher "postiz" is not installed');
    });
    await installPostiz(t);
    await t.run(async (ctx) => {
      expect(await publisherMetaOf(ctx, "postiz")).toMatchObject(POSTIZ_META);
      expect(await publisherMetaOf(ctx, "other")).toBeNull();
      expect((await installedPublishers(ctx)).map((p) => p.adapter)).toEqual(["postiz"]);
    });
  });

  it("serves the bundle and manifest to Node actions only, by adapter", async () => {
    const t = convexTest(schema, modules);
    await installPostiz(t);
    expect(await t.query(internal.publisher_packages.bundleOf, { adapter: "postiz" })).toBeNull(); // no files stored yet
    await t.run(async (ctx) => {
      const pkg = (await ctx.db.query("hubPackages").first())!;
      await ctx.db.insert("hubPackageFiles", { hubPackageId: pkg._id, path: "dist/plugin.mjs", content: "export default {};" });
      await ctx.db.insert("hubPackageFiles", { hubPackageId: pkg._id, path: "manifest.json", content: "{}" });
    });
    expect(await t.query(internal.publisher_packages.bundleOf, { adapter: "postiz" })).toMatchObject({ source: "export default {};", manifest: "{}" });
    expect(await t.query(internal.publisher_packages.bundleOf, { adapter: "other" })).toBeNull();
  });
});
