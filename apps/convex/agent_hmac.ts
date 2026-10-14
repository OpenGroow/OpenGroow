export type KeyRegistryEntry = {
  secret: string;
  instanceId: string;
  ownerId: string;
};
export type KeyRegistry = Record<string, KeyRegistryEntry>;

export function loadKeyRegistry(): KeyRegistry {
  const raw = process.env.AGENT_HMAC_KEYS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as KeyRegistry;
  } catch {
    return {};
  }
}

export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const usedNonces = new Map<string, number>();

function pruneExpiredNonces(now: number) {
  for (const [key, expiry] of usedNonces) {
    if (expiry <= now) usedNonces.delete(key);
  }
}

export async function verifyAgentHmac(
  request: Request,
  rawBody: string,
): Promise<{ ok: false; error: string } | { ok: true; instanceId: string; ownerId: string }> {
  const keyId = request.headers.get("x-agent-key-id");
  const ts = request.headers.get("x-agent-ts");
  const nonce = request.headers.get("x-agent-nonce");
  const signature = request.headers.get("x-agent-signature");

  if (!keyId || !ts || !nonce || !signature) {
    return { ok: false, error: "Missing HMAC headers" };
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, error: "Invalid timestamp" };
  }

  const skew = Math.abs(Date.now() - tsNum);
  if (skew > 300_000) {
    return { ok: false, error: "Timestamp outside allowed skew" };
  }

  const nonceKey = `${keyId}:${nonce}`;
  const now = Date.now();
  pruneExpiredNonces(now);
  if (usedNonces.has(nonceKey)) {
    return { ok: false, error: "Nonce already used" };
  }
  usedNonces.set(nonceKey, now + 300_000);

  const keys = loadKeyRegistry();
  const entry = keys[keyId];
  if (!entry) {
    return { ok: false, error: "Unknown key id" };
  }

  const bodyHash = await sha256Hex(rawBody);
  const path = new URL(request.url).pathname;
  const stringToSign = [request.method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  const expected = await hmacSha256Hex(entry.secret, stringToSign);

  if (!hexEqual(expected, signature.toLowerCase())) {
    return { ok: false, error: "Invalid signature" };
  }

  return { ok: true, instanceId: entry.instanceId, ownerId: entry.ownerId };
}
