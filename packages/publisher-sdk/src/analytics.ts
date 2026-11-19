import { isValidIcon } from "./manifest";

// The contract of an Analytics Adapter (ADR-078, docs/domain/publishing.md).
// Separate from the Publisher contract and versioned on its own. An adapter
// reads how one post performed at a service; the core owns the schedule, the
// retries and the Snapshots; the adapter declares its metrics (ADR-079). Authoring guide:
// docs/ANALYTICS_ADAPTERS.md.

export const ANALYTICS_CONTRACT_VERSION = 2;

/** A metric an adapter declares; the order of the list is the order of the columns (ADR-079). */
export type MetricDecl = {
  key: string;
  label: string;
  /** `counter`: a cumulative total that only grows; `level`: a value that moves. */
  type: "counter" | "level";
  format: "number" | "percent" | "duration";
  /** Which direction is an improvement; `higher` when absent. */
  better?: "higher" | "lower";
  /** A figure computed from the others (never stored): the sum of `sum` keys over the `per` key. */
  derive?: { sum: string[]; per: string };
};

/** What an adapter needs as the secret of its connection: a one-line text by default, or a JSON document with `fields`. */
export type AnalyticsSecretDecl = { label: string; kind: "text" | "json"; fields?: string[] };

const DURATION_PATTERN = /^[1-9]\d*[hd]$/;

/** A `collect` duration (`3d`, `12h`) in milliseconds. */
export function collectDelayMs(duration: string): number {
  return Number.parseInt(duration, 10) * (duration.endsWith("d") ? 24 : 1) * 3_600_000;
}

/** Reading delays counted from the moment a Publication became `published`. */
export const DEFAULT_COLLECT_DELAYS_MS = [1, 3, 7].map((days) => days * 24 * 60 * 60_000);

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
  /** The logo, an image data URI, like a Publisher's. */
  icon?: string;
  options?: AnalyticsOptionDecl[];
  /** The adapter's own metrics, in the order of the columns. */
  metrics: MetricDecl[];
  /** The metric that ranks its posts; one of `metrics`, not derived. */
  primary: string;
  /** Default reading delays, durations like `3d` or `12h`. */
  collect?: string[];
  /** The secret of the connection; default a one-line text. */
  secret?: AnalyticsSecretDecl;
  /** False when the connection has no URL to give; default true. */
  needsUrl?: boolean;
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
  if (m.contractVersion === 1) {
    return { ok: false, error: `${m.name} was built for Analytics contract 1, which is no longer supported: this OpenGroow reads contract ${ANALYTICS_CONTRACT_VERSION}, where the adapter declares its own metrics (metrics, primary) in its manifest. Republish it for contract ${ANALYTICS_CONTRACT_VERSION} (docs/ANALYTICS_ADAPTERS.md)` };
  }
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
  if (m.icon !== undefined && !isValidIcon(m.icon)) {
    return { ok: false, error: "The manifest `icon` must be a png, webp, jpeg or svg data URI of a bounded size" };
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
  const read = parseDeclaration(m);
  if (!read.ok) return read;
  const declared = read.declared;
  return {
    ok: true,
    manifest: {
      ...declared,
      id: m.id,
      name: m.name,
      contractVersion: m.contractVersion,
      needs: m.needs,
      ...(typeof m.publisher === "string" ? { publisher: m.publisher } : {}),
      earliestDelayMs: m.earliestDelayMs,
      ...(typeof m.icon === "string" ? { icon: m.icon } : {}),
      ...(options ? { options } : {}),
    },
  };
}

const METRIC_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

type Declared = Pick<AnalyticsPackageManifest, "metrics" | "primary"> & Partial<Pick<AnalyticsPackageManifest, "collect" | "secret" | "needsUrl">>;

function parseDeclaration(m: Record<string, unknown>): { ok: true; declared: Declared } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!Array.isArray(m.metrics) || m.metrics.length === 0) return fail("The manifest `metrics` must be a non-empty list");
  const metrics: MetricDecl[] = [];
  for (const raw of m.metrics as unknown[]) {
    const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof d.key !== "string" || !METRIC_KEY.test(d.key)) return fail("Each metric needs a `key` of letters and digits");
    if (metrics.some((x) => x.key === d.key)) return fail(`The metric ${d.key} is declared twice`);
    if (typeof d.label !== "string" || d.label.trim() === "") return fail(`The metric ${d.key} needs a label`);
    if (d.type !== "counter" && d.type !== "level") return fail(`The metric ${d.key} must have a type of "counter" or "level"`);
    if (d.format !== "number" && d.format !== "percent" && d.format !== "duration") return fail(`The metric ${d.key} must have a format of "number", "percent" or "duration"`);
    if (d.better !== undefined && d.better !== "higher" && d.better !== "lower") return fail(`The metric ${d.key} must have a better of "higher" or "lower"`);
    metrics.push({ key: d.key, label: d.label, type: d.type, format: d.format, ...(d.better ? { better: d.better } : {}), ...(d.derive !== undefined ? { derive: d.derive as MetricDecl["derive"] } : {}) });
  }
  const keys = new Set(metrics.map((x) => x.key));
  for (const metric of metrics) {
    if (metric.derive === undefined) continue;
    const { derive } = metric;
    if (metric.type !== "level") return fail(`The metric ${metric.key} has a derive, so it must be a level`);
    const valid = typeof derive === "object" && derive !== null && Array.isArray(derive.sum) && derive.sum.length > 0 && typeof derive.per === "string";
    if (!valid) return fail(`The derive of ${metric.key} must be { sum: [keys], per: key }`);
    for (const key of [...derive.sum, derive.per]) {
      if (!keys.has(key)) return fail(`The derive of ${metric.key} names the unknown metric ${String(key)}`);
      if (metrics.find((x) => x.key === key)?.derive) return fail(`The derive of ${metric.key} cannot use the derived metric ${key}`);
    }
  }
  const primary = metrics.find((x) => x.key === m.primary);
  if (!primary || primary.derive) return fail("The manifest `primary` must be one of the metrics, and not a derived one");
  let collect: string[] | undefined;
  if (m.collect !== undefined) {
    if (!Array.isArray(m.collect) || !m.collect.every((c) => typeof c === "string" && DURATION_PATTERN.test(c))) {
      return fail("The manifest `collect` must be a list of durations like 3d or 12h");
    }
    collect = m.collect as string[];
  }
  let secret: AnalyticsSecretDecl | undefined;
  if (m.secret !== undefined) {
    const s = (typeof m.secret === "object" && m.secret !== null ? m.secret : {}) as Record<string, unknown>;
    const fields = s.fields;
    if (typeof s.label !== "string" || s.label.trim() === "" || (s.kind !== "text" && s.kind !== "json")) {
      return fail("The manifest `secret` must be { label, kind: \"text\" or \"json\", fields? }");
    }
    if (fields !== undefined && (s.kind !== "json" || !Array.isArray(fields) || !fields.every((f) => typeof f === "string" && f !== ""))) {
      return fail("The `fields` of the manifest `secret` are a list of names, for a json secret only");
    }
    secret = { label: s.label, kind: s.kind, ...(fields ? { fields: fields as string[] } : {}) };
  }
  if (m.needsUrl !== undefined && typeof m.needsUrl !== "boolean") return fail("The manifest `needsUrl` must be true or false");
  return {
    ok: true,
    declared: { metrics, primary: primary.key, ...(collect ? { collect } : {}), ...(secret ? { secret } : {}), ...(typeof m.needsUrl === "boolean" ? { needsUrl: m.needsUrl } : {}) },
  };
}

/** Keeps the declared metrics that are stored (not derived) whose value is a finite number >= 0; drops the rest. */
export function pickDeclaredMetrics(declared: readonly MetricDecl[], raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { key, derive } of declared) {
    const value = raw[key];
    if (!derive && typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

/** Why `value` cannot be the secret of a connection declared as `secret`, or undefined when it can. */
export function checkConnectionSecret(secret: AnalyticsSecretDecl | undefined, value: string): string | undefined {
  if (secret?.kind !== "json") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return `The ${secret.label} is not valid JSON`;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return `The ${secret.label} must be a JSON object`;
  const object = parsed as Record<string, unknown>;
  const missing = (secret.fields ?? []).filter((f) => typeof object[f] !== "string" || object[f] === "");
  return missing.length > 0 ? `The ${secret.label} lacks the field${missing.length > 1 ? "s" : ""} ${missing.join(", ")}` : undefined;
}

/** `data/metrics.json`: how the labels a service returns map to the metric keys the manifest declares. */
export type AnalyticsMetricsData = { adapter: string; labels: Record<string, string> };

/** Reads `data/metrics.json`; throws with the reason when it is not valid. */
export function parseAnalyticsMetrics(raw: unknown): AnalyticsMetricsData {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (d.schemaVersion !== 1) throw new Error("must be { schemaVersion: 1, adapter, labels: {...} }");
  if (typeof d.adapter !== "string") throw new Error("`adapter` must be a string");
  if (d.kind !== undefined) throw new Error("has a `kind`: the closed metric vocabulary is gone, the manifest declares the metrics (ADR-079). Remove `kind`");
  if (typeof d.labels !== "object" || d.labels === null || Array.isArray(d.labels)) throw new Error("`labels` must be an object");
  const labels: Record<string, string> = {};
  for (const [label, metric] of Object.entries(d.labels)) {
    if (typeof metric !== "string") throw new Error(`the label "${label}" must map to a metric key`);
    labels[label] = metric;
  }
  return { adapter: d.adapter, labels };
}

/** The first label target that is not a stored (declared, not derived) metric, or undefined when `labels` is consistent with the manifest. */
export function strayLabelMetric(declared: readonly MetricDecl[], labels: Record<string, string>): string | undefined {
  const stored = declared.filter((m) => !m.derive).map((m) => m.key);
  return Object.values(labels).find((key) => !stored.includes(key));
}

export type ReadRequest = {
  /** The id the publishing service gave the post (set when `needs` is `externalId`). */
  externalId?: string;
  /** The post's public URL (set when `needs` is `url`). */
  url?: string;
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
