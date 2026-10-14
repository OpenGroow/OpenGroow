"use node";

import { action, internalAction } from "./_generated/server.js";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { HmacVerifier, type HmacVerifyResult } from "@opengroow/hmac";

const eventValidator = v.object({
  id: v.string(),
  type: v.string(),
  payload: v.optional(v.any()),
  ts: v.number(),
});

const hmacArgsValidator = v.object({
  keyId: v.string(),
  ts: v.string(),
  nonce: v.string(),
  signature: v.string(),
});

type SignedIngestBody = {
  instanceId: string;
  event: { id: string; type: string; payload?: unknown; ts: number };
};

// The verifier is built once per Node isolate rather than per invocation:
// `HmacVerifier` keeps its seen-nonce cache in memory, so a fresh instance
// per call would hand every signed request an empty cache and let it be
// replayed for the whole five-minute skew window (docs/adr/007-hmac-for-inter-service-authentication.md).
// Isolate reuse makes this best-effort across the fleet — the durable
// backstop is `events.store`, which de-dupes on (instanceId, event.id) —
// but it is what makes the nonce check mean anything at all. Same pattern
// as the module-level nonce map in agent_hmac.ts.
let cachedVerifier: HmacVerifier | null = null;
let cachedVerifierKeyId: string | null = null;
let cachedVerifierSecret: string | null = null;

function buildVerifier(): HmacVerifier | null {
  const secret = process.env.BROKER_SECRET;
  const keyId = process.env.BROKER_KEY_ID;
  if (!secret || !keyId) return null;
  if (cachedVerifier && cachedVerifierKeyId === keyId && cachedVerifierSecret === secret) {
    return cachedVerifier;
  }
  cachedVerifier = new HmacVerifier({
    keyRegistry: { [keyId]: { secret } },
    prefix: "broker",
    skewMs: 300_000,
    nonceTtlMs: 300_000,
  });
  cachedVerifierKeyId = keyId;
  cachedVerifierSecret = secret;
  return cachedVerifier;
}

/**
 * Re-read the instanceId/event out of the body that was actually signed.
 * The HMAC only covers `rawBody`, so persisting the separate `instanceId`
 * and `event` arguments would let a caller replay a captured signature with
 * swapped arguments and still be trusted (docs/HMAC.md).
 */
function parseSignedBody(rawBody: string): SignedIngestBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { instanceId, event } = parsed as Record<string, unknown>;
  if (typeof instanceId !== "string" || typeof event !== "object" || event === null) {
    return null;
  }
  const { id, type, payload, ts } = event as Record<string, unknown>;
  if (typeof id !== "string" || typeof type !== "string" || typeof ts !== "number") {
    return null;
  }
  return { instanceId, event: { id, type, payload, ts } };
}

export const ingest = action({
  args: {
    instanceId: v.string(),
    event: eventValidator,
    hmac: v.optional(hmacArgsValidator),
    rawBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.hmac) {
      return { status: 401, ok: false, error: "Missing HMAC headers" };
    }
    const verifier = buildVerifier();
    if (!verifier) {
      return { status: 500, ok: false, error: "Server misconfiguration" };
    }

    const bodyToVerify = args.rawBody ?? JSON.stringify({ instanceId: args.instanceId, event: args.event });
    const result: HmacVerifyResult = verifier.verify({
      headers: {
        "x-broker-key-id": args.hmac.keyId,
        "x-broker-ts": args.hmac.ts,
        "x-broker-nonce": args.hmac.nonce,
        "x-broker-signature": args.hmac.signature,
      },
      method: "POST",
      path: "/events/ingest",
      body: bodyToVerify,
    });
    if (!result.ok) {
      return { status: 401, ok: false, error: result.error };
    }

    // Persist what was signed, never the loose arguments. Without `rawBody`
    // the signed body *is* the serialisation of those arguments, so they are
    // covered by the signature and can be used directly.
    const verified = args.rawBody === undefined
      ? { instanceId: args.instanceId, event: args.event }
      : parseSignedBody(args.rawBody);
    if (!verified) {
      return { status: 400, ok: false, error: "Signed body is not a valid ingest payload" };
    }

    await ctx.runMutation(internal.events.store, {
      instanceId: verified.instanceId,
      event: verified.event,
    });
    return { status: 200, ok: true };
  },
});

export const signalWaitingAction = internalAction({
  args: {
    instanceId: v.string(),
    commandId: v.id("commands"),
    type: v.string(),
    payload: v.any(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.events.storeCommandResult, args);
    return null;
  },
});
