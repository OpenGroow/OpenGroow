"use node";

import { v } from "convex/values";
import type { PublisherChannel } from "@opengroow/publisher-sdk";
import { internal } from "./_generated/api.js";
import { action } from "./_generated/server.js";
import { NO_PUBLISHER } from "./publishers.js";
import { loadPlugin } from "./publisher/load_node.js";
import { messageOf } from "./error_message.js";

// The Publisher calls the dashboard makes while the user sets a Publisher up.
// They run the plugin's code, so they are Node actions (ADR-072).

export const testConnection = action({
  args: { instanceId: v.string(), adapter: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    const conn = await ctx.runQuery(internal.publishers.loadConnection, args);
    if (!conn) return { ok: false, error: NO_PUBLISHER };
    if (!conn.apiKey) return { ok: false, error: "No API key configured" };
    try {
      return await (await loadPlugin(ctx, conn.adapter)).testConnection(conn);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  },
});

export const listChannels = action({
  args: { instanceId: v.string(), adapter: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; channels: PublisherChannel[] } | { ok: false; error: string }> => {
    const conn = await ctx.runQuery(internal.publishers.loadConnection, args);
    if (!conn) return { ok: false, error: NO_PUBLISHER };
    if (!conn.apiKey) return { ok: false, error: "No API key configured" };
    try {
      return await (await loadPlugin(ctx, conn.adapter)).listChannels(conn);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  },
});
