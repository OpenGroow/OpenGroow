export type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

export type ProviderUsageSnapshot = {
  provider: string;
  displayName: string;
  windows: UsageWindow[];
  summary?: string;
  plan?: string;
  error?: string;
};

export type ParsedOpenClawUsage = {
  parsed: boolean;
  updatedAt?: number;
  providers: ProviderUsageSnapshot[];
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const label = toOptionalString(record.label);
  const usedPercent = toNumber(record.usedPercent);
  if (!label || usedPercent === undefined) {
    return null;
  }
  return { label, usedPercent, resetAt: toNumber(record.resetAt) };
}

function normalizeProvider(raw: Record<string, unknown>): ProviderUsageSnapshot | null {
  const provider = toOptionalString(raw.provider);
  if (!provider) {
    return null;
  }
  const windows = Array.isArray(raw.windows)
    ? raw.windows
        .map(normalizeWindow)
        .filter((window): window is UsageWindow => window !== null)
    : [];
  return {
    provider,
    displayName: toOptionalString(raw.displayName) ?? provider,
    windows,
    summary: toOptionalString(raw.summary),
    plan: toOptionalString(raw.plan),
    error: toOptionalString(raw.error),
  };
}

/**
 * Extracts the first complete top-level `{...}` object from `text`, ignoring
 * anything before or after it. The control socket's exec channel sometimes
 * interleaves incidental stderr-ish lines (e.g. a secrets-config notice)
 * with the CLI's stdout, so the JSON payload isn't always the entire trimmed
 * string — but it's always a single well-formed object somewhere in it.
 */
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/**
 * Parses the output of `openclaw status --usage --json`.
 *
 * Despite the feature name, this CLI flag reports rate-limit *quota*
 * snapshots per model provider — how much of each provider's usage window
 * has been consumed (`windows: [{ label, usedPercent, resetAt }]`) — not
 * token counts or a dollar cost. There is no `inputTokens`/`costUsd` field
 * anywhere in the CLI's output; see `ProviderUsageSnapshot` in the
 * `openclaw` package's own `provider-usage.types.d.ts`.
 *
 * Expected shape: `{ usage: { updatedAt, providers: [{ provider,
 * displayName, windows, summary?, plan?, error? }] } }`. Anything else
 * (unparseable JSON, missing `usage.providers`, or no provider entries with
 * a recognizable `provider` field) is reported as `parsed: false` so
 * callers can fall back to a generic message instead of showing bogus data.
 */
export function parseOpenClawUsageOutput(rawOutput: string): ParsedOpenClawUsage {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { parsed: false, providers: [] };
  }

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    const extracted = extractFirstJsonObject(trimmed);
    if (!extracted) {
      return { parsed: false, providers: [] };
    }
    try {
      data = JSON.parse(extracted);
    } catch {
      return { parsed: false, providers: [] };
    }
  }

  if (!data || typeof data !== "object") {
    return { parsed: false, providers: [] };
  }
  const usage = (data as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return { parsed: false, providers: [] };
  }
  const usageRecord = usage as Record<string, unknown>;
  if (!Array.isArray(usageRecord.providers)) {
    return { parsed: false, providers: [] };
  }

  const providers = usageRecord.providers
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map(normalizeProvider)
    .filter((provider): provider is ProviderUsageSnapshot => provider !== null);

  if (providers.length === 0) {
    return { parsed: false, providers: [] };
  }

  return { parsed: true, updatedAt: toNumber(usageRecord.updatedAt), providers };
}
