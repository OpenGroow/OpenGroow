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

/** Whether `metric` belongs to the vocabulary of `kind`. */
export function isMetricOfKind(kind: MetricKind, metric: unknown): boolean {
  return (METRIC_VOCABULARY[kind] as readonly unknown[]).includes(metric);
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

/**
 * Per-Project connection to the measuring service. `options` are the values the Project gave for what
 * the package declares in its manifest (`AnalyticsOptionDecl`); a missing one means the declared default.
 */
export type AnalyticsConnection = { url: string; apiKey: string; options?: Record<string, string | number> };

/** An option a package lets each Project set (shown on the Project's analytics settings). */
export type AnalyticsOptionDecl = {
  key: string;
  label: string;
  type: "number" | "text";
  default: string | number;
  min?: number;
  max?: number;
};

/**
 * The manifest of an Analytics Adapter package (`manifest.json`): what the core reads at install
 * without running the code, like the Publisher's (ADR-072).
 */
export type AnalyticsPackageManifest = {
  /** Stable id, the value a channel is linked to. */
  id: string;
  name: string;
  contractVersion: number;
  /** The key it needs from a Publication. */
  needs: AnalyticsKey;
  /** The Publisher (its adapter id) this adapter belongs to; required when `needs` is `externalId`. */
  publisher?: string;
  /** The earliest delay after publication at which the service can report (ms). */
  earliestDelayMs: number;
  options?: AnalyticsOptionDecl[];
};

/** What the core keeps of an installed Analytics Adapter package, readable without its code (the manifest, minus the contract version). */
export type AnalyticsAdapterMeta = Omit<AnalyticsPackageManifest, "contractVersion">;

const ID_PATTERN =/^[a-z0-9][a-z0-9-]*$/;

/** Reads and validates the manifest of an Analytics Adapter package; refuses another contract version. */
export function parseAnalyticsManifest(raw: unknown): { ok: true; manifest: AnalyticsPackageManifest } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "The manifest must be an object" };
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) return { ok: false, error: "The manifest `id` must be lowercase letters, digits and dashes" };
  if (typeof m.name !== "string" || m.name.trim() === "") return { ok: false, error: "The manifest `name` must be a non-empty string" };
  if (m.contractVersion !== ANALYTICS_CONTRACT_VERSION) {
    return { ok: false, error: `${m.name} was built for Analytics contract ${String(m.contractVersion)}, this OpenGroow supports contract ${ANALYTICS_CONTRACT_VERSION}` };
  }
  if (m.needs !== "externalId" && m.needs !== "url") return { ok: false, error: "The manifest `needs` must be \"externalId\" or \"url\"" };
  if (m.publisher !== undefined && (typeof m.publisher !== "string" || !ID_PATTERN.test(m.publisher))) {
    return { ok: false, error: "The manifest `publisher` must be a Publisher id" };
  }
  if (m.needs === "externalId" && m.publisher === undefined) {
    return { ok: false, error: "An adapter that needs the externalId must name its `publisher`: the id only means something to that service" };
  }
  if (typeof m.earliestDelayMs !== "number" || !Number.isFinite(m.earliestDelayMs) || m.earliestDelayMs < 0) {
    return { ok: false, error: "The manifest `earliestDelayMs` must be a number of ms, 0 or more" };
  }
  let options: AnalyticsOptionDecl[] | undefined;
  if (m.options !== undefined) {
    if (!Array.isArray(m.options)) return { ok: false, error: "The manifest `options` must be a list" };
    options = [];
    for (const raw of m.options as unknown[]) {
      const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      if (typeof o.key !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(o.key)) return { ok: false, error: "Each option needs a `key` of letters and digits" };
      if (typeof o.label !== "string" || o.label.trim() === "") return { ok: false, error: `The option ${o.key} needs a label` };
      if (o.type !== "number" && o.type !== "text") return { ok: false, error: `The option ${o.key} must be of type "number" or "text"` };
      if (typeof o.default !== (o.type === "number" ? "number" : "string")) return { ok: false, error: `The default of the option ${o.key} must be a ${o.type === "number" ? "number" : "string"}` };
      for (const bound of ["min", "max"] as const) {
        if (o[bound] !== undefined && (o.type !== "number" || typeof o[bound] !== "number")) return { ok: false, error: `The option ${o.key} has an invalid ${bound}` };
      }
      options.push({
        key: o.key,
        label: o.label,
        type: o.type,
        default: o.default as string | number,
        ...(typeof o.min === "number" ? { min: o.min } : {}),
        ...(typeof o.max === "number" ? { max: o.max } : {}),
      });
    }
  }
  return {
    ok: true,
    manifest: {
      id: m.id,
      name: m.name,
      contractVersion: m.contractVersion,
      needs: m.needs,
      ...(typeof m.publisher === "string" ? { publisher: m.publisher } : {}),
      earliestDelayMs: m.earliestDelayMs,
      ...(options ? { options } : {}),
    },
  };
}

/** `data/metrics.json`: how the labels a service returns map to the closed vocabulary of a kind. */
export type AnalyticsMetricsData = { adapter: string; kind: MetricKind; labels: Record<string, string> };

/** Reads `data/metrics.json`; throws with the reason when it is not valid. */
export function parseAnalyticsMetrics(raw: unknown): AnalyticsMetricsData {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (d.schemaVersion !== 1) throw new Error("must be { schemaVersion: 1, adapter, kind, labels: {...} }");
  if (typeof d.adapter !== "string") throw new Error("`adapter` must be a string");
  if (d.kind !== "social" && d.kind !== "article") throw new Error("`kind` must be \"social\" or \"article\"");
  if (typeof d.labels !== "object" || d.labels === null || Array.isArray(d.labels)) throw new Error("`labels` must be an object");
  const labels: Record<string, string> = {};
  for (const [label, metric] of Object.entries(d.labels)) {
    if (!isMetricOfKind(d.kind, metric)) throw new Error(`the label "${label}" maps to "${String(metric)}", which is not a ${d.kind} metric`);
    labels[label] = metric as string;
  }
  return { adapter: d.adapter, kind: d.kind, labels };
}

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
