import { createHmac, createHash, timingSafeEqual, randomUUID } from "node:crypto";

export type StringToSignInput = {
  method: string;
  path: string;
  ts: string;
  nonce: string;
  bodyHash?: string;
};

export type HmacHeaders = {
  keyId: string;
  ts: string;
  nonce: string;
  signature: string;
};

export type HmacHeaderPrefix = string;

export function buildStringToSign(input: StringToSignInput): string {
  const method = input.method.toUpperCase();
  const parts = [method, input.path, input.ts, input.nonce];
  if (input.bodyHash !== undefined) {
    parts.push(input.bodyHash);
  }
  return parts.join("\n");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function signHmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (!isHex(left) || !isHex(right) || left.length !== right.length) {
    return false;
  }
  const leftBuf = Buffer.from(left, "hex");
  const rightBuf = Buffer.from(right, "hex");
  return timingSafeEqual(leftBuf, rightBuf);
}

export function buildHmacHeaders(input: HmacHeaders, prefix: HmacHeaderPrefix): Record<string, string> {
  const normalized = prefix.toLowerCase();
  return {
    [`x-${normalized}-key-id`]: input.keyId,
    [`x-${normalized}-ts`]: input.ts,
    [`x-${normalized}-nonce`]: input.nonce,
    [`x-${normalized}-signature`]: input.signature
  };
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

export function parseHmacHeaders(
  headers: HeaderSource,
  prefix: HmacHeaderPrefix
): HmacHeaders | null {
  const normalized = prefix.toLowerCase();
  const keyId = getHeader(headers, `x-${normalized}-key-id`);
  const ts = getHeader(headers, `x-${normalized}-ts`);
  const nonce = getHeader(headers, `x-${normalized}-nonce`);
  const signature = getHeader(headers, `x-${normalized}-signature`);
  if (!keyId || !ts || !nonce || !signature) {
    return null;
  }
  return { keyId, ts, nonce, signature };
}

function getHeader(
  headers: HeaderSource,
  name: string
): string | undefined {
  if (isHeaders(headers)) {
    return headers.get(name) ?? undefined;
  }
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function isHeaders(headers: HeaderSource): headers is Headers {
  return typeof (headers as Headers).get === "function";
}

export class HmacSigner {
  private readonly keyId: string;
  private readonly secret: string;
  private readonly prefix: string;

  constructor(opts: { keyId: string; secret: string; prefix: string }) {
    this.keyId = opts.keyId;
    this.secret = opts.secret;
    this.prefix = opts.prefix;
  }

  sign(method: string, path: string, body?: string): Record<string, string> {
    const ts = String(Date.now());
    const nonce = randomUUID();
    const bodyHash = body !== undefined ? sha256Hex(body) : undefined;
    const stringToSign = buildStringToSign({ method, path, ts, nonce, bodyHash });
    const signature = signHmac(this.secret, stringToSign);
    return buildHmacHeaders({ keyId: this.keyId, ts, nonce, signature }, this.prefix);
  }
}

export type HmacVerifyResult =
  | { ok: true; keyId: string }
  | { ok: false; error: string };

export class HmacVerifier {
  private readonly keyRegistry: Record<string, { secret: string }>;
  private readonly prefix: string;
  private readonly skewMs: number;
  private readonly nonceCache: ReturnType<typeof createNonceCache>;

  constructor(opts: {
    keyRegistry: Record<string, { secret: string }>;
    prefix: string;
    skewMs?: number;
    nonceTtlMs?: number;
  }) {
    this.keyRegistry = opts.keyRegistry;
    this.prefix = opts.prefix;
    this.skewMs = opts.skewMs ?? 0;
    this.nonceCache = createNonceCache(opts.nonceTtlMs ?? 0);
  }

  verify(input: {
    headers: HeaderSource;
    method: string;
    path: string;
    body?: string | Buffer;
  }): HmacVerifyResult {
    const parsed = parseHmacHeaders(input.headers, this.prefix);
    if (!parsed) {
      return { ok: false, error: "Missing HMAC headers" };
    }
    const { keyId, ts, nonce, signature } = parsed;

    const record = this.keyRegistry[keyId];
    if (!record) {
      return { ok: false, error: "Unknown key id" };
    }

    const tsNumber = Number(ts);
    if (!Number.isFinite(tsNumber)) {
      return { ok: false, error: "Invalid timestamp" };
    }
    if (this.skewMs > 0) {
      const skew = Math.abs(Date.now() - tsNumber);
      if (skew > this.skewMs) {
        return { ok: false, error: "Timestamp outside allowed skew" };
      }
    }
    if (!this.nonceCache.register("", keyId, nonce)) {
      return { ok: false, error: "Nonce already used" };
    }

    const bodyHash = input.body !== undefined ? sha256Hex(input.body) : undefined;
    const stringToSign = buildStringToSign({
      method: input.method,
      path: input.path,
      ts,
      nonce,
      bodyHash,
    });
    const expected = signHmac(record.secret, stringToSign);
    if (!safeEqualHex(expected, signature)) {
      return { ok: false, error: "Invalid signature" };
    }

    return { ok: true, keyId };
  }
}

// Shared by every Convex-side "call an HMAC-signed control-plane HTTP API"
// client (apps/convex/instance_provisioning/{control_plane,local}.ts): sign the
// request, fetch with a timeout, and parse the response as JSON-or-raw. A
// network failure or timeout returns a {status, error} shape instead of
// throwing, so callers can treat it the same as any other non-2xx response.
export type SignedJsonApiRequest = {
  signer: HmacSigner;
  baseUrl: string;
  method: string;
  path: string;
  body?: unknown;
  timeoutMs: number;
  // Named in the network/timeout error messages, e.g. "OpenClaw control
  // service" → "OpenClaw control service unreachable".
  serviceName: string;
};

export async function callSignedJsonApi(
  input: SignedJsonApiRequest
): Promise<Record<string, unknown>> {
  const url = new URL(input.path, input.baseUrl).toString();
  const rawBody = input.body !== undefined ? JSON.stringify(input.body) : undefined;
  const hmacHeaders = input.signer.sign(input.method, input.path, rawBody);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: input.method,
        headers: {
          "content-type": "application/json",
          ...hmacHeaders
        },
        body: rawBody
      },
      input.timeoutMs
    );
  } catch (error) {
    return {
      status: isAbortError(error) ? 504 : 502,
      error: isAbortError(error)
        ? `${input.serviceName} timed out`
        : `${input.serviceName} unreachable`
    };
  }

  const text = await response.text();
  if (!text) {
    return { status: response.status };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, raw: text };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createNonceCache(ttlMs: number) {
  const cache = new Map<string, number>();
  return {
    register(scope: string, keyId: string, nonce: string): boolean {
      if (ttlMs <= 0) {
        return true;
      }
      const now = Date.now();
      const cacheKey = `${scope}:${keyId}:${nonce}`;
      const existing = cache.get(cacheKey);
      if (existing !== undefined && now - existing < ttlMs) {
        return false;
      }
      cache.set(cacheKey, now);
      for (const [key, ts] of cache) {
        if (now - ts > ttlMs) {
          cache.delete(key);
        }
      }
      return true;
    }
  };
}
