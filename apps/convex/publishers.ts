import { v } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { adapterFor } from "./publisher/postiz.js";
import type { PublisherChannel } from "./publisher/adapter.js";

// Project-level Publisher (ADR-069): one configuration per Project, V1 adapter
// Postiz. The API key is write-only from the dashboard's point of view.

const TARGET_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/;
const NO_PUBLISHER = "No Publisher configured";

function assertTarget(target: string): string {
  const name = target.trim();
  if (!TARGET_PATTERN.test(name)) {
    throw new Error(`Invalid Publish target "${target}": use lowercase words such as "instagram" or "pinterest:recipes"`);
  }
  return name;
}

async function requirePublisher(ctx: MutationCtx, instanceId: string) {
  await ownerIdFor(ctx, instanceId);
  const publisher = await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  if (!publisher) throw new Error(NO_PUBLISHER);
  return publisher;
}

export const get = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return null;
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    if (!publisher) return null;
    return {
      adapter: publisher.adapter,
      url: publisher.url,
      hasApiKey: Boolean(publisher.apiKey),
      targets: publisher.targets.map((t) =>
        t.channelId
          ? {
              target: t.target,
              mapped: true as const,
              channelId: t.channelId,
              channelName: t.channelName,
              channelService: t.channelService,
              settings: t.settings,
            }
          : { target: t.target, mapped: false as const },
      ),
    };
  },
});

export const save = mutation({
  args: {
    instanceId: v.string(),
    adapter: v.literal("postiz"),
    url: v.string(),
    // Omit to keep the stored key.
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const url = args.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Invalid Publisher URL");
    const apiKey = args.apiKey?.trim() || undefined;
    const existing = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        adapter: args.adapter,
        url,
        ...(apiKey ? { apiKey } : {}),
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("publishers", {
      instanceId: args.instanceId,
      adapter: args.adapter,
      url,
      apiKey,
      targets: [],
      updatedAt: now,
    });
  },
});

export const addTarget = mutation({
  args: { instanceId: v.string(), target: v.string() },
  handler: async (ctx, args) => {
    const target = assertTarget(args.target);
    const publisher = await requirePublisher(ctx, args.instanceId);
    if (publisher.targets.some((t) => t.target === target)) return;
    await ctx.db.patch(publisher._id, {
      targets: [...publisher.targets, { target }],
      updatedAt: Date.now(),
    });
  },
});

export const mapTarget = mutation({
  args: {
    instanceId: v.string(),
    target: v.string(),
    channelId: v.string(),
    channelName: v.optional(v.string()),
    channelService: v.optional(v.string()),
    settings: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const target = assertTarget(args.target);
    const publisher = await requirePublisher(ctx, args.instanceId);
    const entry = {
      target,
      channelId: args.channelId,
      channelName: args.channelName,
      channelService: args.channelService,
      settings: args.settings,
    };
    const exists = publisher.targets.some((t) => t.target === target);
    await ctx.db.patch(publisher._id, {
      targets: exists
        ? publisher.targets.map((t) => (t.target === target ? entry : t))
        : [...publisher.targets, entry],
      updatedAt: Date.now(),
    });
  },
});

export const removeTarget = mutation({
  args: { instanceId: v.string(), target: v.string() },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId);
    await ctx.db.patch(publisher._id, {
      targets: publisher.targets.filter((t) => t.target !== args.target),
      updatedAt: Date.now(),
    });
  },
});

/** Server-side only: the connection including the secret, after an ownership check. */
export const loadConnection = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    if (!publisher) return null;
    return { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey ?? "" };
  },
});

export const testConnection = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    const conn = await ctx.runQuery(internal.publishers.loadConnection, args);
    if (!conn) return { ok: false, error: NO_PUBLISHER };
    if (!conn.apiKey) return { ok: false, error: "No API key configured" };
    return await adapterFor(conn.adapter).testConnection(conn);
  },
});

export const listChannels = action({
  args: { instanceId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; channels: PublisherChannel[] } | { ok: false; error: string }> => {
    const conn = await ctx.runQuery(internal.publishers.loadConnection, args);
    if (!conn) return { ok: false, error: NO_PUBLISHER };
    if (!conn.apiKey) return { ok: false, error: "No API key configured" };
    return await adapterFor(conn.adapter).listChannels(conn);
  },
});
