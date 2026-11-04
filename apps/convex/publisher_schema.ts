import { defineTable } from "convex/server";
import { v } from "convex/values";

// Publisher tables (ADR-069), kept apart from schema.ts so publishing slices
// stay localized. One Publisher per Project (V1).
export const publisherTables = {
  publishers: defineTable({
    instanceId: v.string(),
    adapter: v.literal("postiz"),
    url: v.string(),
    // Never returned to the dashboard in clear: queries expose `hasApiKey` only.
    apiKey: v.optional(v.string()),
    // Logical Publish targets. A target without `channelId` is unmapped.
    targets: v.array(
      v.object({
        target: v.string(),
        channelId: v.optional(v.string()),
        channelName: v.optional(v.string()),
        settings: v.optional(v.record(v.string(), v.any())),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),
};
