"use node";

import { ANALYTICS_CONTRACT_VERSION, type AnalyticsAdapter } from "@opengroow/publisher-sdk";
import { internal } from "../_generated/api.js";
import type { ActionCtx } from "../_generated/server.js";
import { loadCachedBundle } from "../bundle_loader_node.js";

// Loads an installed Analytics Adapter package (ADR-078), like the Publisher
// loader (ADR-072), through `loadCachedBundle`.

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
  return loadCachedBundle(cache, bundle, `The Analytics Adapter "${adapterId}"`, (exported) => check(exported, adapterId));
}
