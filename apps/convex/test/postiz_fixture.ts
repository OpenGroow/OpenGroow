// Test fixture for the core's Publisher tests (ADR-072). The core no longer
// knows Postiz: an installed package supplies its data (`meta`) and its plugin
// is loaded from a bundle in Node actions. Tests install the Postiz package's
// data into the database and replace the bundle loader with the plugin itself
// (the real loader is covered by publisher_load.test.ts).
//
// In a test file: vi.mock("../publisher/load_node.js", async () => (await import("./postiz_fixture")).postizLoaderModule);

import type { convexTest } from "convex-test";
import { postizManifest, postizPlugin } from "../../../packages/publisher-postiz/src/index";

export const POSTIZ_META = {
  adapter: postizManifest.id,
  name: postizManifest.name,
  postUrl: postizManifest.postUrl,
  capabilities: postizPlugin.capabilities,
  channelOptions: postizPlugin.channelOptions,
};

/** Installs the Postiz package's data, as `hub_packages_node.install` stores it. */
export async function installPostiz(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("hubPackages", {
      packageId: "@opengroow/publisher-postiz",
      kind: "publisher",
      version: "1.0.0",
      tag: "publisher-postiz@1.0.0",
      digest: `sha256:${"0".repeat(64)}`,
      verification: "official",
      meta: POSTIZ_META,
      installedAt: Date.now(),
    });
  });
}

export const postizLoaderModule = {
  loadPlugin: async (_ctx: unknown, adapter: string) => {
    if (adapter !== postizPlugin.id) throw new Error(`The Publisher "${adapter}" is not installed`);
    return postizPlugin;
  },
};
