export type OpenClawKeyRecord = {
  openClawId: string;
  secret: string;
  resources?: string[];
};

export type OpenClawKeyRegistry = Record<string, OpenClawKeyRecord>;

export type ConvexKeyRecord = {
  secret: string;
};

export type ConvexKeyRegistry = Record<string, ConvexKeyRecord>;

const DEFAULT_OPENCLAW_KEYS: OpenClawKeyRegistry = {
  dev: {
    openClawId: "openclaw-dev-1",
    secret: "dev-secret"
  }
};

const DEFAULT_CONVEX_KEYS: ConvexKeyRegistry = {
  convex: {
    secret: "convex-secret"
  }
};

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseJsonEnv<T>(name: string, raw: string): T {
  const candidates = [stripWrappingQuotes(raw)];
  candidates.push(candidates[0].replace(/\\"/g, "\""));
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Failed to parse ${name}: ${lastError instanceof Error ? lastError.message : "invalid JSON"}`
  );
}

export function loadOpenClawKeys(): OpenClawKeyRegistry {
  const raw = process.env.BROKER_OPENCLAW_KEYS;
  if (!raw) {
    return DEFAULT_OPENCLAW_KEYS;
  }
  try {
    const parsed = parseJsonEnv<OpenClawKeyRegistry>("BROKER_OPENCLAW_KEYS", raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid BROKER_OPENCLAW_KEYS");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse BROKER_OPENCLAW_KEYS: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
}

export function loadConvexKeys(): ConvexKeyRegistry {
  const raw = process.env.BROKER_CONVEX_KEYS;
  if (!raw) {
    return DEFAULT_CONVEX_KEYS;
  }
  try {
    const parsed = parseJsonEnv<ConvexKeyRegistry>("BROKER_CONVEX_KEYS", raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid BROKER_CONVEX_KEYS");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse BROKER_CONVEX_KEYS: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
}
