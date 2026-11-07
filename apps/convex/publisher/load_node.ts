"use node";

import { checkPublisherPlugin, parsePublisherManifest, type PublisherPlugin } from "@opengroow/publisher-sdk";
import { internal } from "../_generated/api.js";
import type { ActionCtx } from "../_generated/server.js";

// Loads an installed Publisher package's plugin (ADR-072). Only Node actions
// can: the bundle is evaluated with a data: import, which the V8 runtime of
// queries and mutations does not allow. The bundle is the hub's, verified by
// digest at install, and runs with the core's rights (no isolation).

const cache = new Map<string, PublisherPlugin>();

/**
 * The plugin of the installed Publisher `adapter`. Cached per package digest:
 * an upgrade changes the digest, so a new version is loaded on its first use
 * and the old one is simply no longer asked for.
 */
export async function loadPlugin(ctx: ActionCtx, adapter: string): Promise<PublisherPlugin> {
  const bundle = await ctx.runQuery(internal.publisher_packages.bundleOf, { adapter });
  if (!bundle) throw new Error(`The Publisher "${adapter}" is not installed`);
  const key = `${bundle.packageId}#${bundle.digest}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(bundle.manifest);
  } catch {
    throw new Error(`The Publisher "${adapter}" has an unreadable manifest`);
  }
  const manifest = parsePublisherManifest(rawManifest);
  if (!manifest.ok) throw new Error(manifest.error);

  let module: { default?: unknown };
  try {
    module = await import(/* webpackIgnore: true */ `data:text/javascript;base64,${Buffer.from(bundle.source).toString("base64")}`);
  } catch (error) {
    throw new Error(`The Publisher "${manifest.manifest.name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const checked = checkPublisherPlugin(module.default, manifest.manifest);
  if (!checked.ok) throw new Error(checked.error);
  const plugin = module.default as PublisherPlugin;
  cache.set(key, plugin);
  return plugin;
}
