"use node";

import { checkPublisherPlugin, parsePublisherManifest, type PublisherPlugin } from "@opengroow/publisher-sdk";
import { internal } from "../_generated/api.js";
import type { ActionCtx } from "../_generated/server.js";
import { loadCachedBundle } from "../bundle_loader_node.js";

// Loads an installed Publisher package's plugin (ADR-072), through `loadCachedBundle`.

const cache = new Map<string, PublisherPlugin>();

/**
 * The plugin of the installed Publisher `adapter`. Cached per package digest:
 * an upgrade changes the digest, so a new version is loaded on its first use
 * and replaces the old one in the cache.
 */
export async function loadPlugin(ctx: ActionCtx, adapter: string): Promise<PublisherPlugin> {
  const bundle = await ctx.runQuery(internal.publisher_packages.bundleOf, { adapter });
  if (!bundle) throw new Error(`The Publisher "${adapter}" is not installed`);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(bundle.manifest);
  } catch {
    throw new Error(`The Publisher "${adapter}" has an unreadable manifest`);
  }
  const manifest = parsePublisherManifest(rawManifest);
  if (!manifest.ok) throw new Error(manifest.error);
  return loadCachedBundle(cache, bundle, `The Publisher "${manifest.manifest.name}"`, (exported) => {
    const checked = checkPublisherPlugin(exported, manifest.manifest);
    if (!checked.ok) throw new Error(checked.error);
    return exported as PublisherPlugin;
  });
}
