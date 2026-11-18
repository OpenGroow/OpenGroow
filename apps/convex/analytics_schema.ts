import { defineTable } from "convex/server";
import { v } from "convex/values";

// Analytics tables (ADR-078), kept apart from schema.ts like the publisher ones.

/**
 * Where the readings of a Publication stand. `waiting`: the next reading is
 * not due yet (or its key is missing). `no_data` and `failed`: the last try
 * is retried. `post_unknown`, `complete` and `unmeasured` are final.
 */
export const analyticsStateV = v.union(
  v.literal("waiting"),
  v.literal("no_data"),
  v.literal("failed"),
  v.literal("post_unknown"),
  v.literal("complete"),
  v.literal("unmeasured"),
);

export const analyticsTables = {
  // One row per Publication measured: the schedule and the state of its readings.
  publicationAnalytics: defineTable({
    publicationId: v.id("publications"),
    instanceId: v.string(),
    /** The Publisher the Publication went through; its Analytics Adapter by default. */
    publisherAdapter: v.string(),
    /** When the Publication became `published`: the delays count from here. */
    publishedAt: v.number(),
    /** Reading delays after `publishedAt` (ms), one Snapshot each. */
    delays: v.array(v.number()),
    /** How many Snapshots were taken: the index of the next delay. */
    taken: v.number(),
    state: analyticsStateV,
    /** Why the last reading failed, or why the post is unknown. */
    reason: v.optional(v.string()),
    /** When the next reading is tried. */
    nextAt: v.number(),
    /** Final: no more readings. */
    done: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_publication", ["publicationId"])
    .index("by_done_and_next", ["done", "nextAt"]),

  // Append-only: a row is never patched or deleted (one series per Publication).
  performanceSnapshots: defineTable({
    publicationId: v.id("publications"),
    instanceId: v.string(),
    /** The delay after `published` this reading stands for. */
    delayMs: v.number(),
    takenAt: v.number(),
    /** Metrics of the closed vocabulary of the Publication's kind. */
    metrics: v.record(v.string(), v.number()),
    source: v.literal("adapter"),
  }).index("by_publication", ["publicationId"]),
};
