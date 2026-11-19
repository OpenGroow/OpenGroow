import { v } from "convex/values";
import { checkConnectionSecret, type AnalyticsOptionDecl } from "@opengroow/publisher-sdk";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import type { AnalyticsAdapterMeta } from "@opengroow/publisher-sdk";
import { installedAnalyticsAdapters } from "./analytics_adapters.js";

// The connection of an Analytics Adapter, configured once per Project (ADR-078),
// like a Publisher's (publishers.ts): a URL, an API key that never goes back to
// the dashboard, and the options the package declares. A Project that sets
// nothing still measures through the connection of the adapter's own Publisher.

type Connection = { url: string; apiKey: string; options?: Record<string, string | number> };

/** The stored connection of `adapter` for a Project, or null. */
export async function projectAnalyticsConnection(ctx: Pick<QueryCtx, "db">, instanceId: string, adapter: string) {
  return await ctx.db
    .query("analyticsConnections")
    .withIndex("by_instance_and_adapter", (q) => q.eq("instanceId", instanceId).eq("adapter", adapter))
    .unique();
}

/**
 * What `adapter` reads with for a Project: its own connection when it has a key, else the connection
 * of the Publisher it belongs to (`publisher`, when that one has a key). The options come from the own
 * connection only; the adapter falls back to the defaults it declares.
 */
export function connectionFor(
  own: { url: string; apiKey?: string; options?: Record<string, string | number> } | null,
  publisher: { url: string; apiKey?: string } | undefined,
): Connection | undefined {
  if (own?.apiKey) return { url: own.url, apiKey: own.apiKey, ...(own.options ? { options: own.options } : {}) };
  if (publisher?.apiKey) return { url: publisher.url, apiKey: publisher.apiKey, ...(own?.options ? { options: own.options } : {}) };
  return undefined;
}

/** Throws when `options` holds a key the package does not declare or a value out of its type or range. */
function checkOptions(decls: readonly AnalyticsOptionDecl[], options: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(options)) {
    const decl = decls.find((d) => d.key === key);
    if (!decl) throw new Error(`This adapter has no option "${key}"`);
    if (decl.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || (decl.min !== undefined && value < decl.min) || (decl.max !== undefined && value > decl.max)) {
        throw new Error(`The option ${key} must be a number${decl.min !== undefined ? ` from ${decl.min}` : ""}${decl.max !== undefined ? ` to ${decl.max}` : ""}`);
      }
    } else if (typeof value !== "string") {
      throw new Error(`The option ${key} must be text`);
    }
  }
}

async function requireAdapter(ctx: Pick<QueryCtx, "db">, adapter: string): Promise<AnalyticsAdapterMeta> {
  const meta = (await installedAnalyticsAdapters(ctx)).find((a) => a.id === adapter);
  if (!meta) throw new Error(`The Analytics Adapter "${adapter}" is not installed`);
  return meta;
}

/** The installed adapters with this Project's connection to each (never its API key). */
export const list = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    const out = [];
    for (const adapter of await installedAnalyticsAdapters(ctx)) {
      const stored = await projectAnalyticsConnection(ctx, args.instanceId, adapter.id);
      out.push({
        adapter: adapter.id,
        name: adapter.name,
        ...(adapter.icon ? { icon: adapter.icon } : {}),
        ...(adapter.publisher ? { publisher: adapter.publisher } : {}),
        optionDecls: adapter.options ?? [],
        // Absent means the default: a one-line text secret and a URL to give.
        ...(adapter.secret ? { secret: adapter.secret } : {}),
        ...(adapter.needsUrl === false ? { needsUrl: false } : {}),
        configured: Boolean(stored?.apiKey),
        ...(stored ? { url: stored.url, hasApiKey: Boolean(stored.apiKey), options: stored.options ?? {} } : {}),
      });
    }
    return out;
  },
});

export const save = mutation({
  args: {
    instanceId: v.string(),
    adapter: v.string(),
    // Omit to keep the stored URL: an adapter that reads through its Publisher's connection only has options to save.
    url: v.optional(v.string()),
    // Omit to keep the stored key.
    apiKey: v.optional(v.string()),
    options: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const meta = await requireAdapter(ctx, args.adapter);
    const existing = await projectAnalyticsConnection(ctx, args.instanceId, args.adapter);
    const url = args.url === undefined ? (existing?.url ?? "") : args.url.trim().replace(/\/+$/, "");
    // An adapter with no URL to give accepts an empty one.
    const urlOptional = meta.needsUrl === false && url === "";
    if (args.url !== undefined && !urlOptional && !/^https?:\/\/\S+$/.test(url)) throw new Error("Invalid URL");
    const options = args.options ?? {};
    checkOptions(meta.options ?? [], options);
    const apiKey = args.apiKey?.trim() || undefined;
    if (apiKey) {
      const problem = checkConnectionSecret(meta.secret, apiKey);
      if (problem) throw new Error(problem);
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { url, options, ...(apiKey ? { apiKey } : {}), updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("analyticsConnections", { instanceId: args.instanceId, adapter: args.adapter, url, apiKey, options, updatedAt: now });
  },
});

export const remove = mutation({
  args: { instanceId: v.string(), adapter: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const existing = await projectAnalyticsConnection(ctx, args.instanceId, args.adapter);
    if (existing) await ctx.db.delete(existing._id);
  },
});
