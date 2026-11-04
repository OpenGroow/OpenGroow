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

  // One row per (Mission, Publish target) (ADR-069). Later slices extend it
  // without a migration: multi-target (#18) adds rows, `scheduledAt` and
  // polling (#19) use the same fields, retry (#20) reuses a `failed` row.
  publications: defineTable({
    missionId: v.id("missions"),
    instanceId: v.string(),
    target: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("failed"),
    ),
    // The post at the external service (its id, and its URL when it has one).
    externalId: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mission", ["missionId"])
    .index("by_mission_target", ["missionId", "target"])
    .index("by_status", ["status"]),
};
