import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildStringToSign,
  sha256Hex,
  signHmac,
  safeEqualHex,
  buildHmacHeaders,
  parseHmacHeaders,
  createNonceCache,
  callSignedJsonApi,
  HmacSigner,
  HmacVerifier,
} from "./index.js";

describe("hmac helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds canonical string to sign", () => {
    const result = buildStringToSign({
      method: "post",
      path: "/broker/commands",
      ts: "123",
      nonce: "abc",
      bodyHash: "deadbeef"
    });
    expect(result).toBe("POST\n/broker/commands\n123\nabc\ndeadbeef");
  });

  it("hashes and signs deterministically", () => {
    const bodyHash = sha256Hex("hello");
    expect(bodyHash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    const signature = signHmac("secret", "payload");
    expect(signature).toBe("b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4");
  });

  it("builds and parses headers", () => {
    const headers = buildHmacHeaders(
      { keyId: "convex", ts: "1", nonce: "n", signature: "sig" },
      "broker"
    );
    expect(headers["x-broker-key-id"]).toBe("convex");
    const parsed = parseHmacHeaders(headers, "broker");
    expect(parsed).toEqual({ keyId: "convex", ts: "1", nonce: "n", signature: "sig" });

    const headerObj = new Headers(headers);
    const parsedFromHeaders = parseHmacHeaders(headerObj, "broker");
    expect(parsedFromHeaders).toEqual({ keyId: "convex", ts: "1", nonce: "n", signature: "sig" });
  });

  it("compares hex signatures safely", () => {
    expect(safeEqualHex("aa", "AA")).toBe(true);
    expect(safeEqualHex("aa", "ab")).toBe(false);
    expect(safeEqualHex("zz", "zz")).toBe(false);
  });

  it("de-dupes nonces within TTL", () => {
    const cache = createNonceCache(1000);
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    expect(cache.register("scope", "key", "nonce")).toBe(true);
    expect(cache.register("scope", "key", "nonce")).toBe(false);
    now.mockReturnValue(2500);
    expect(cache.register("scope", "key", "nonce")).toBe(true);
  });
});

describe("HmacSigner", () => {
  it("produces verifiable headers", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "broker" });
    const headers = signer.sign("POST", "/broker/commands", '{"hello":"world"}');
    expect(headers["x-broker-key-id"]).toBe("k1");
    expect(headers["x-broker-ts"]).toMatch(/^\d+$/);
    expect(headers["x-broker-nonce"]).toBeTruthy();
    expect(headers["x-broker-signature"]).toBeTruthy();
  });

  it("omits body hash when body is absent", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "broker" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const headers1 = signer.sign("GET", "/path");
    const headers2 = signer.sign("GET", "/path", "");
    now.mockRestore();
    const sig1 = headers1["x-broker-signature"];
    const sig2 = headers2["x-broker-signature"];
    expect(sig1).not.toBe(sig2);
  });
});

describe("HmacVerifier", () => {
  const keyRegistry = { k1: { secret: "s1" } };

  it("accepts a valid signed request", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test" });
    const body = '{"foo":"bar"}';
    const headers = signer.sign("POST", "/path", body);
    const result = verifier.verify({ headers, method: "POST", path: "/path", body });
    expect(result).toEqual({ ok: true, keyId: "k1" });
  });

  it("accepts a WS-style request without body", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test" });
    const headers = signer.sign("GET", "/ws");
    const result = verifier.verify({ headers, method: "GET", path: "/ws" });
    expect(result).toEqual({ ok: true, keyId: "k1" });
  });

  it("rejects missing headers", () => {
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test" });
    const result = verifier.verify({ headers: {}, method: "POST", path: "/path" });
    expect(result).toEqual({ ok: false, error: "Missing HMAC headers" });
  });

  it("rejects unknown key id", () => {
    const signer = new HmacSigner({ keyId: "unknown", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test" });
    const headers = signer.sign("POST", "/path");
    const result = verifier.verify({ headers, method: "POST", path: "/path" });
    expect(result).toEqual({ ok: false, error: "Unknown key id" });
  });

  it("rejects a tampered body", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test" });
    const headers = signer.sign("POST", "/path", "original");
    const result = verifier.verify({ headers, method: "POST", path: "/path", body: "tampered" });
    expect(result).toEqual({ ok: false, error: "Invalid signature" });
  });

  it("rejects a replayed nonce", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test", nonceTtlMs: 60_000 });
    const headers = signer.sign("POST", "/path");
    verifier.verify({ headers, method: "POST", path: "/path" });
    const result = verifier.verify({ headers, method: "POST", path: "/path" });
    expect(result).toEqual({ ok: false, error: "Nonce already used" });
  });

  it("rejects a request outside the skew window", () => {
    const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "test" });
    const verifier = new HmacVerifier({ keyRegistry, prefix: "test", skewMs: 1000 });
    vi.spyOn(Date, "now").mockReturnValue(0);
    const headers = signer.sign("POST", "/path");
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const result = verifier.verify({ headers, method: "POST", path: "/path" });
    expect(result).toEqual({ ok: false, error: "Timestamp outside allowed skew" });
  });
});

// Shared by apps/convex/instance_provisioning/{control_plane,local}.ts (extracted
// from their near-identical callControlApi/callLocalControlApi during
// #306's simplify pass).
describe("callSignedJsonApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const signer = new HmacSigner({ keyId: "k1", secret: "s1", prefix: "control" });

  it("signs and POSTs the given path/body, parsing a JSON response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 200, ok: true }), { status: 200 }),
    );

    const result = await callSignedJsonApi({
      signer,
      baseUrl: "http://control.test",
      method: "POST",
      path: "/instances",
      body: { nameSuffix: "demo" },
      timeoutMs: 5000,
      serviceName: "test control service",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://control.test/instances");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ nameSuffix: "demo" });
    expect((init.headers as Record<string, string>)["x-control-key-id"]).toBe("k1");
    expect(result).toEqual({ status: 200, ok: true });
  });

  it("returns a {status, raw} shape for a non-JSON response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not json", { status: 502 }),
    );

    const result = await callSignedJsonApi({
      signer,
      baseUrl: "http://control.test",
      method: "GET",
      path: "/instances",
      timeoutMs: 5000,
      serviceName: "test control service",
    });

    expect(result).toEqual({ status: 502, raw: "not json" });
  });

  it("returns a {status: 502, error} shape when the network call rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fetch failed"));

    const result = await callSignedJsonApi({
      signer,
      baseUrl: "http://control.test",
      method: "GET",
      path: "/instances",
      timeoutMs: 5000,
      serviceName: "test control service",
    });

    expect(result).toEqual({ status: 502, error: "test control service unreachable" });
  });

  it("returns a {status: 504, error} shape when the request times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });

    const result = await callSignedJsonApi({
      signer,
      baseUrl: "http://control.test",
      method: "GET",
      path: "/instances",
      timeoutMs: 1,
      serviceName: "test control service",
    });

    expect(result).toEqual({ status: 504, error: "test control service timed out" });
  });
});
