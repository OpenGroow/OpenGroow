// The contract of an Analytics Adapter (ADR-078, docs/domain/publishing.md).
// Separate from the Publisher contract and versioned on its own. An adapter
// reads how one post performed at a service; the core owns the schedule, the
// retries, the Snapshots and the closed metric vocabulary.

export const ANALYTICS_CONTRACT_VERSION = 1;

/** The closed metric vocabulary per kind of content, owned by OpenGroow. */
export const METRIC_VOCABULARY = {
  social: ["views", "reach", "likes", "comments", "shares", "saves"],
  article: ["pageviews", "visitors", "engagementTime"],
} as const;

export type MetricKind = keyof typeof METRIC_VOCABULARY;

/** Reading delays counted from the moment a Publication became `published`. */
export const DEFAULT_COLLECT_DELAYS_MS = [1, 3, 7].map((days) => days * 24 * 60 * 60_000);

/** The metric kind of a Publishable kind: `article` is measured as a page, everything else as a social post. */
export function metricKindOf(publishableKind: string | undefined): MetricKind {
  return publishableKind === "article" ? "article" : "social";
}

/** Keeps the metrics of the vocabulary of `kind` whose value is a finite number >= 0; ignores the rest. */
export function pickMetrics(kind: MetricKind, raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of METRIC_VOCABULARY[kind]) {
    const value = raw[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[name] = value;
  }
  return out;
}

/** The key an adapter needs from a Publication to find the post on its side (free for now, ADR-078). */
export type AnalyticsKey = "externalId" | "url";

/** Per-Project connection to the measuring service. */
export type AnalyticsConnection = { url: string; apiKey: string };

export type ReadRequest = {
  /** The id the publishing service gave the post (set when `needs` is `externalId`). */
  externalId?: string;
  /** The post's public URL (set when `needs` is `url`). */
  url?: string;
  kind: MetricKind;
  /** Epoch ms when the Publication became `published`. */
  publishedAt: number;
};

/**
 * What a reading found. `no_data`: the service answered but has nothing yet
 * (retried, not an error). `unavailable`: the service does not know the post
 * (stop, keep history).
 */
export type AnalyticsReading =
  | { status: "taken"; metrics: Record<string, unknown> }
  | { status: "no_data" }
  | { status: "unavailable"; reason: string };

/** `ok: false` is a failure of the reading (network, auth, unreadable answer): retried and shown with its reason. */
export type AnalyticsResult = { ok: true; reading: AnalyticsReading } | { ok: false; error: string };

export interface AnalyticsAdapter {
  /** Stable id of the adapter. */
  readonly id: string;
  readonly name: string;
  /** The contract version this adapter implements (`ANALYTICS_CONTRACT_VERSION`). */
  readonly contractVersion: number;
  /** The key it needs from a Publication. */
  readonly needs: AnalyticsKey;
  /** The earliest delay after publication at which its service can report (ms). */
  readonly earliestDelayMs: number;
  read(conn: AnalyticsConnection, request: ReadRequest): Promise<AnalyticsResult>;
}
