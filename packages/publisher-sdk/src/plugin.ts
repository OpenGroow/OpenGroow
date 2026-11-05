// The contract of a Publisher plugin (ADR-070, docs/PUBLISHER_PLUGINS.md).
// A plugin is an isolated code module: it receives everything through its
// arguments, never imports from the application, and owns all knowledge of the
// external service. The core owns the Publication lifecycle (statuses,
// submitting/uncertain, reconcile-before-resend, polling, publishAt rules).

import type { CapabilitiesData } from "./capabilities";
import type { ChannelOptionsData } from "./channel-options";

/** Per-Project connection to the external service. */
export type PublisherConnection = { url: string; apiKey: string };

/** A destination of the external service (the service's own "channel" concept). */
export type PublisherChannel = {
  id: string;
  name: string;
  service: string;
  picture?: string;
  /** The account handle on the service (for example `love_youmake`). */
  profile?: string;
  disabled?: boolean;
};

/** `uncertain`: the failure does not prove the service rejected the request (network error, timeout, 5xx, unreadable answer). */
export type PublisherResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string; uncertain?: boolean };

/** A media already uploaded to the service from its source `url`. */
export type UploadedMedia = { url: string; id: string; path: string };

export type PublishRequest = {
  channelId: string;
  /** The channel's service (for example `instagram`), when known from the mapping. */
  channelService?: string;
  /** Service-specific settings stored on the Publish target. */
  settings?: Record<string, unknown>;
  /** The Publishable (unified format, references only). */
  publishable: Record<string, unknown>;
  /** Absent = publish immediately. */
  publishAt?: number;
  /** Media uploaded by an earlier attempt: reused instead of uploading again. */
  media?: UploadedMedia[];
  /**
   * Called with the uploaded media right before the post is created. Returning
   * false cancels the send (another caller owns this Publication).
   */
  beforePost?: (media: UploadedMedia[]) => Promise<boolean>;
};

/** The states a post can be found in at the service (the core adds `submitting` and `uncertain`). */
export type ExternalPostStatus = "pending" | "scheduled" | "published" | "failed";

/** What `findPost` looks for: a post the service may have accepted without telling us. */
export type FindPostQuery = {
  channelId: string;
  caption: string;
  /** Epoch ms when the attempt started. */
  attemptStartedAt: number;
  /** The date the post was asked for (epoch ms): the schedule date, or the attempt time for "now". */
  attemptDate: number;
};

export type PublishOutcome = {
  externalId: string;
  status: Exclude<ExternalPostStatus, "failed">;
  externalUrl?: string;
};

export type PostStatus = {
  status: ExternalPostStatus;
  externalUrl?: string;
  error?: string;
};

export interface PublisherPlugin {
  /** Stable id, the value stored as a Publisher's `adapter`. */
  readonly id: string;
  /** Service name shown in user-facing messages ("Postiz may have received this post"). */
  readonly name: string;
  /** Data file: which Publishable kinds each platform can carry. */
  readonly capabilities: CapabilitiesData;
  /** Data file: per-platform options the dashboard offers on a channel. */
  readonly channelOptions: ChannelOptionsData;

  testConnection(conn: PublisherConnection): Promise<PublisherResult>;
  listChannels(conn: PublisherConnection): Promise<PublisherResult<{ channels: PublisherChannel[] }>>;
  publish(conn: PublisherConnection, request: PublishRequest): Promise<PublisherResult<{ outcome: PublishOutcome }>>;
  /**
   * Reconciliation before a re-send: the post on `channelId` whose content is
   * `caption` and whose creation or publish date falls in the attempt window,
   * or null. A post the service itself marked as errored is not a match.
   */
  findPost(
    conn: PublisherConnection,
    query: FindPostQuery,
  ): Promise<PublisherResult<{ post: ({ externalId: string } & PostStatus) | null }>>;
  /**
   * Where a post stands at the service. `around` (epoch ms) is the date the post
   * was scheduled for; plugins whose API can only list posts by date use it as
   * the search window. A post the service no longer knows is reported `failed`.
   */
  getStatus(conn: PublisherConnection, externalId: string, around?: number): Promise<PublisherResult<{ post: PostStatus }>>;
}
