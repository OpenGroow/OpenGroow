// Adapter-agnostic Publisher interface (ADR-069, docs/domain/publishing.md).
// A Publisher is one adapter plus its per-Project configuration. V1 has a
// single adapter, Postiz; a second service is a new implementation of this
// interface, not a new architecture.

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
  disabled?: boolean;
};

export type PublisherResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

export type PublishRequest = {
  channelId: string;
  /** Service-specific settings stored on the Publish target. */
  settings?: Record<string, unknown>;
  /** The Publishable (unified format, references only). */
  publishable: Record<string, unknown>;
  /** Absent = publish immediately. */
  publishAt?: number;
};

export type PublishOutcome = {
  externalId: string;
  status: "scheduled" | "published" | "pending";
  externalUrl?: string;
};

export type PostStatus = {
  status: "scheduled" | "published" | "pending" | "failed";
  externalUrl?: string;
  error?: string;
};

export interface PublisherAdapter {
  testConnection(conn: PublisherConnection): Promise<PublisherResult>;
  listChannels(conn: PublisherConnection): Promise<PublisherResult<{ channels: PublisherChannel[] }>>;
  publish(conn: PublisherConnection, request: PublishRequest): Promise<PublisherResult<{ outcome: PublishOutcome }>>;
  getStatus(conn: PublisherConnection, externalId: string): Promise<PublisherResult<{ post: PostStatus }>>;
}
