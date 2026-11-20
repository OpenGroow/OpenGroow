/**
 * The Agent token (ADR-080): what an Agent presents to the Internal MCP. It is
 * stored as the Agent's `apiKey` (ADR-017), so the existing activation path
 * writes it as the server's Authorization header.
 *
 * Shape: `ogt_<base64url({instanceId, templateId})>.<random hex secret>`. The
 * first part only says which Agent to check the secret against (so the lookup
 * is an index read, not a scan); the secret is what authenticates.
 */
const PREFIX = "ogt_";
const SECRET_BYTES = 32;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function generateAgentToken(instanceId: string, templateId: string): string {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${PREFIX}${toBase64Url(JSON.stringify({ i: instanceId, t: templateId }))}.${secret}`;
}

/** The Agent a token claims to belong to, or undefined when it is not shaped like an Agent token. Says nothing about validity. */
export function parseAgentToken(token: string): { instanceId: string; templateId: string } | undefined {
  if (!token.startsWith(PREFIX)) return undefined;
  const [identity, secret, ...rest] = token.slice(PREFIX.length).split(".");
  if (!identity || !secret || rest.length > 0) return undefined;
  try {
    const parsed = JSON.parse(fromBase64Url(identity)) as { i?: unknown; t?: unknown };
    if (typeof parsed.i !== "string" || typeof parsed.t !== "string") return undefined;
    return { instanceId: parsed.i, templateId: parsed.t };
  } catch {
    return undefined;
  }
}

/** Compares two secrets without stopping at the first differing character. */
export function tokensMatch(presented: string, stored: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(stored);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}
