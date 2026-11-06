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
import { pluginFor } from "./publisher/registry.js";
import type { PublisherChannel } from "@opengroow/publisher-sdk";

// Project-level Publisher (ADR-069): one configuration per Project, backed by a
// Publisher plugin (ADR-070). The API key is write-only from the dashboard's point of view.

const NO_PUBLISHER = "No Publisher configured";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The generated key of a channel entry (a Publish target): always
 * `<platform>:<handle>`, with no exception. The handle is the account's profile
 * on the service; a channel without one cannot be added. The user never names
 * it (ADR-069).
 */
export function generateTargetKey(channel: { channelService: string; channelProfile?: string }): string {
  const platform = slug(channel.channelService) || "channel";
  const handle = slug(channel.channelProfile ?? "");
  if (!handle) throw new Error("This channel has no handle, so it cannot be added");
  return `${platform}:${handle}`;
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
              channelProfile: t.channelProfile,
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
    adapter: v.string(),
    url: v.string(),
    // Omit to keep the stored key.
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    pluginFor(args.adapter); // refuses an unregistered plugin
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

/** Adds a channel of the Publisher's account; returns its generated key. Adding the same channel again returns its existing key. */
export const addChannel = mutation({
  args: {
    instanceId: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    channelService: v.string(),
    channelProfile: v.optional(v.string()),
    settings: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args): Promise<string> => {
    const publisher = await requirePublisher(ctx, args.instanceId);
    const existing = publisher.targets.find((t) => t.channelId === args.channelId);
    if (existing) return existing.target;
    const target = generateTargetKey(args);
    if (publisher.targets.some((t) => t.target === target)) {
      throw new Error("A channel with this handle is already added");
    }
    const { instanceId: _instanceId, ...channel } = args;
    await ctx.db.patch(publisher._id, {
      targets: [...publisher.targets, { target, ...channel }],
      updatedAt: Date.now(),
    });
    return target;
  },
});

export const updateSettings = mutation({
  args: { instanceId: v.string(), target: v.string(), settings: v.record(v.string(), v.any()) },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId);
    if (!publisher.targets.some((t) => t.target === args.target)) {
      throw new Error(`Unknown channel "${args.target}"`);
    }
    await ctx.db.patch(publisher._id, {
      targets: publisher.targets.map((t) => (t.target === args.target ? { ...t, settings: args.settings } : t)),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Stores the account handles of channels added before the handle was kept (their
 * key may then be a bare `instagram`), in one write. Never overwrites a stored
 * handle, skips a channel that is no longer on the Publisher, and leaves the
 * keys untouched so Missions and Schedules that reference them keep working.
 */
export const setChannelProfiles = mutation({
  args: {
    instanceId: v.string(),
    profiles: v.array(v.object({ target: v.string(), channelProfile: v.string() })),
  },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId);
    const byTarget = new Map(args.profiles.filter((p) => p.channelProfile.trim()).map((p) => [p.target, p.channelProfile]));
    let changed = false;
    const targets = publisher.targets.map((t) => {
      const profile = byTarget.get(t.target);
      if (!profile || t.channelProfile) return t;
      changed = true;
      return { ...t, channelProfile: profile };
    });
    if (changed) await ctx.db.patch(publisher._id, { targets, updatedAt: Date.now() });
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
    return await pluginFor(conn.adapter).testConnection(conn);
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
    return await pluginFor(conn.adapter).listChannels(conn);
  },
});
