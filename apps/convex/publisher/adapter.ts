// Adapter-agnostic Publisher interface (ADR-069, docs/domain/publishing.md).
// A Publisher is one adapter plus its per-Project configuration. V1 has a
// single adapter, Postiz; a second service is a new implementation of this
// interface, not a new architecture.

import type { PublicationStatus } from "../publisher_schema.js";

export const PUBLISHER_ADAPTER_IDS = ["postiz"] as const;
export type PublisherAdapterId = (typeof PUBLISHER_ADAPTER_IDS)[number];

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

/** The service states a post can be found in. */
export type ExternalPostStatus = Exclude<PublicationStatus, "submitting" | "uncertain">;

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

export interface PublisherAdapter {
  testConnection(conn: PublisherConnection): Promise<PublisherResult>;
  listChannels(conn: PublisherConnection): Promise<PublisherResult<{ channels: PublisherChannel[] }>>;
  publish(conn: PublisherConnection, request: PublishRequest): Promise<PublisherResult<{ outcome: PublishOutcome }>>;
  /**
   * Where a post stands at the service. `around` (epoch ms) is the date the post
   * was scheduled for; adapters whose API can only list posts by date use it as
   * the search window. A post the service no longer knows is reported `failed`.
   */
  /**
   * Reconciliation before a re-send: the post on `channelId` whose content is
   * `caption` and whose creation or publish date falls in the attempt window,
   * or null. A post the service itself marked as errored is not a match.
   */
  findPost(
    conn: PublisherConnection,
    query: FindPostQuery,
  ): Promise<PublisherResult<{ post: ({ externalId: string } & PostStatus) | null }>>;
  getStatus(
    conn: PublisherConnection,
    externalId: string,
    around?: number,
  ): Promise<PublisherResult<{ post: PostStatus }>>;
}
