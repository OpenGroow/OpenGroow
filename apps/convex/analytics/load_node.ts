"use node";

import { ANALYTICS_CONTRACT_VERSION, type AnalyticsAdapter } from "@opengroow/publisher-sdk";
import { internal } from "../_generated/api.js";
import type { ActionCtx } from "../_generated/server.js";

// Loads an installed Analytics Adapter package (ADR-078), like the Publisher
// loader (ADR-072): only Node actions can evaluate the bundle, which is the
// hub's, verified by digest at install, and runs with the core's rights.

const cache = new Map<string, AnalyticsAdapter>();

function check(value: unknown, id: string): AnalyticsAdapter {
  const adapter = value as Partial<AnalyticsAdapter> | undefined;
  if (!adapter || typeof adapter.read !== "function") throw new Error(`The Analytics Adapter "${id}" does not export an adapter`);
  if (adapter.id !== id) throw new Error(`The Analytics Adapter "${id}" declares the id "${String(adapter.id)}"`);
  if (adapter.contractVersion !== ANALYTICS_CONTRACT_VERSION) {
    throw new Error(`The Analytics Adapter "${id}" implements contract ${String(adapter.contractVersion)}, this OpenGroow reads contract ${ANALYTICS_CONTRACT_VERSION}`);
  }
  if (adapter.needs !== "externalId" && adapter.needs !== "url") throw new Error(`The Analytics Adapter "${id}" declares an unknown key`);
  if (typeof adapter.earliestDelayMs !== "number" || adapter.earliestDelayMs < 0) throw new Error(`The Analytics Adapter "${id}" declares no valid earliest delay`);
  return adapter as AnalyticsAdapter;
}

/**
 * The installed Analytics Adapter `adapterId` (the one a channel is linked to), or null when
 * no installed package provides it. Cached per package digest: an upgrade changes the digest.
 */
export async function loadAnalyticsAdapter(ctx: ActionCtx, adapterId: string): Promise<AnalyticsAdapter | null> {
  const bundle = await ctx.runQuery(internal.analytics_adapters.bundleOf, { adapter: adapterId });
  if (!bundle) return null;
  const key = `${bundle.packageId}#${bundle.digest}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let module: { default?: unknown };
  try {
    module = await import(/* webpackIgnore: true */ `data:text/javascript;base64,${Buffer.from(bundle.source).toString("base64")}`);
  } catch (error) {
    throw new Error(`The Analytics Adapter "${adapterId}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  const adapter = check(module.default, adapterId);
  for (const k of cache.keys()) if (k.startsWith(`${bundle.packageId}#`)) cache.delete(k);
  cache.set(key, adapter);
  return adapter;
}
