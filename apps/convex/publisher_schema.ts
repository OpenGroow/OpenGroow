import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

/** The one status vocabulary of a Publication, shared by the table, the adapter
 * (`PostStatus`) and the review projection. */
export const publicationStatusV = v.union(
  v.literal("pending"),
  // About to POST /posts (set just before the call); `uncertain` = the POST may
  // have reached the service without us knowing (see ADR-069, retry amendment).
  v.literal("submitting"),
  v.literal("uncertain"),
  v.literal("scheduled"),
  v.literal("published"),
  v.literal("failed"),
);
export type PublicationStatus = Infer<typeof publicationStatusV>;

/** The `publish.onPublished` call of a Publication: `service` is the notified MCP server. */
export const publicationNotificationV = v.object({
  status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed")),
  service: v.string(),
  error: v.optional(v.string()),
  updatedAt: v.number(),
});
export type PublicationNotification = Infer<typeof publicationNotificationV>;

/** References and destination used by one send, retained for reconciliation (ADR-074). */
export const publicationAttemptContextV = v.object({
  adapter: v.string(),
  url: v.string(),
  channelId: v.string(),
  channelService: v.optional(v.string()),
  settings: v.optional(v.record(v.string(), v.any())),
  publishable: v.record(v.string(), v.any()),
});

// Publisher tables (ADR-069), kept apart from schema.ts so publishing slices
// stay localized. One Publisher per Project (V1).
export const publisherTables = {
  publishers: defineTable({
    instanceId: v.string(),
    /** Id of a registered Publisher plugin (the installed Publisher package, ADR-072). */
    adapter: v.string(),
    url: v.string(),
    // Never returned to the dashboard in clear: queries expose `hasApiKey` only.
    apiKey: v.optional(v.string()),
    // The channels of the Publisher. `target` is the generated key of an entry
    // (a Publish target); a legacy entry without `channelId` is unmapped.
    targets: v.array(
      v.object({
        target: v.string(),
        channelId: v.optional(v.string()),
        channelName: v.optional(v.string()),
        channelService: v.optional(v.string()),
        channelProfile: v.optional(v.string()),
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
    status: publicationStatusV,
    // The post at the external service (its id, and its URL when it has one).
    externalId: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    error: v.optional(v.string()),
    // Media already uploaded to the service (by source URL), reused by a retry.
    media: v.optional(v.array(v.object({ url: v.string(), id: v.string(), path: v.string() }))),
    // The window of the last POST /posts attempt: when it started and the date it asked for.
    attemptStartedAt: v.optional(v.number()),
    attemptDate: v.optional(v.number()),
    attemptContext: v.optional(publicationAttemptContextV),
    // The `publish.onPublished` call made once this Publication was published
    // (ADR-074, #62): its presence is what prevents a second call on a replay.
    // Never blocking: `failed` is a warning, the Publication stays published.
    notification: v.optional(publicationNotificationV),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mission", ["missionId"])
    .index("by_mission_target", ["missionId", "target"])
    .index("by_status", ["status"]),
};
