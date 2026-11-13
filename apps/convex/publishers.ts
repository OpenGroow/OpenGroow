import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { requirePublisherMeta } from "./publisher_packages.js";
import { servesPlatform } from "@opengroow/publisher-sdk";
import { allChannels, MAX_PUBLISHERS_PER_PROJECT, projectPublisher, projectPublishers, type ProjectPublisher } from "./project_publishers.js";

// Project-level Publishers (ADR-069, ADR-075): several per Project, at most one
// per adapter, each backed by a Publisher plugin (ADR-070). A channel key is
// unique across them. The API key is write-only from the dashboard's point of view.

export const NO_PUBLISHER = "No Publisher configured";

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
  // A handle may name an owner and a repository (`acme/site`, a GitHub channel): its slash is kept between slugged parts.
  const handle = (channel.channelProfile ?? "").split("/").map(slug).filter(Boolean).join("/");
  if (!handle) throw new Error("This channel has no handle, so it cannot be added");
  return `${platform}:${handle}`;
}

async function requirePublisher(ctx: MutationCtx, instanceId: string, adapter: string) {
  await ownerIdFor(ctx, instanceId);
  const publisher = await projectPublisher(ctx, instanceId, adapter);
  if (!publisher) throw new Error(NO_PUBLISHER);
  return publisher;
}

/** What the dashboard sees of a Publisher: never its API key. */
function view(publisher: ProjectPublisher) {
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
}

/** The Project's Publishers, oldest first. */
export const list = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if (!(await readOwnerId(ctx, args.instanceId))) return [];
    return (await projectPublishers(ctx, args.instanceId)).map(view);
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
    await requirePublisherMeta(ctx, args.adapter); // refuses a Publisher whose package is not installed
    const url = args.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Invalid Publisher URL");
    const apiKey = args.apiKey?.trim() || undefined;
    const existing = await projectPublisher(ctx, args.instanceId, args.adapter);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        url,
        ...(apiKey ? { apiKey } : {}),
        updatedAt: now,
      });
      return existing._id;
    }
    if ((await projectPublishers(ctx, args.instanceId)).length >= MAX_PUBLISHERS_PER_PROJECT) {
      throw new Error(`A Project has at most ${MAX_PUBLISHERS_PER_PROJECT} Publishers`);
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
    adapter: v.string(),
    channelId: v.string(),
    channelName: v.string(),
    channelService: v.string(),
    channelProfile: v.optional(v.string()),
    settings: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args): Promise<string> => {
    const publisher = await requirePublisher(ctx, args.instanceId, args.adapter);
    const existing = publisher.targets.find((t) => t.channelId === args.channelId);
    if (existing) return existing.target;
    // Only the platforms the package declares are offered (ADR-075): the others were never tried.
    const meta = await requirePublisherMeta(ctx, args.adapter);
    if (!servesPlatform(meta.capabilities, args.channelService)) {
      throw new Error(`${meta.name} does not publish to "${args.channelService}" in OpenGroow`);
    }
    const target = generateTargetKey(args);
    // The key alone names the channel in Missions and Schedules: it must be unique across the Project's Publishers.
    if (allChannels(await projectPublishers(ctx, args.instanceId)).some((t) => t.target === target)) {
      throw new Error(`A channel "${target}" is already added to this Project`);
    }
    const { instanceId: _instanceId, adapter: _adapter, ...channel } = args;
    await ctx.db.patch(publisher._id, {
      targets: [...publisher.targets, { target, ...channel }],
      updatedAt: Date.now(),
    });
    return target;
  },
});

export const updateSettings = mutation({
  args: { instanceId: v.string(), adapter: v.string(), target: v.string(), settings: v.record(v.string(), v.any()) },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId, args.adapter);
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
    adapter: v.string(),
    profiles: v.array(v.object({ target: v.string(), channelProfile: v.string() })),
  },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId, args.adapter);
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
  args: { instanceId: v.string(), adapter: v.string(), target: v.string() },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId, args.adapter);
    await ctx.db.patch(publisher._id, {
      targets: publisher.targets.filter((t) => t.target !== args.target),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Removes a Publisher from the Project, with its connection and channels. Its
 * Publications stay (history); a Mission or Schedule still naming one of its
 * channels is refused at publish time ("Unknown channel") until it is changed.
 */
export const remove = mutation({
  args: { instanceId: v.string(), adapter: v.string() },
  handler: async (ctx, args) => {
    const publisher = await requirePublisher(ctx, args.instanceId, args.adapter);
    await ctx.db.delete(publisher._id);
  },
});

/** Server-side only: the connection including the secret, after an ownership check. */
export const loadConnection = internalQuery({
  args: { instanceId: v.string(), adapter: v.string() },
  handler: async (ctx, args) => {
    await ownerIdFor(ctx, args.instanceId);
    const publisher = await projectPublisher(ctx, args.instanceId, args.adapter);
    if (!publisher) return null;
    return { adapter: publisher.adapter, url: publisher.url, apiKey: publisher.apiKey ?? "" };
  },
});
