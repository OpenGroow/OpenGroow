import { describe, expect, it } from "vitest";
import {
  computeConnectTicketExpiresAt,
  isConnectTicketExpired,
  buildPublicExpiresAt,
} from "../connect_tickets_utils";

describe("computeConnectTicketExpiresAt", () => {
  it("returns 0 when ttlMs is 0 (no-expiry sentinel)", () => {
    expect(computeConnectTicketExpiresAt(1_000_000, 0)).toBe(0);
  });

  it("returns createdAt + ttlMs when ttlMs is positive", () => {
    expect(computeConnectTicketExpiresAt(1_000_000, 30 * 60 * 1_000)).toBe(
      1_000_000 + 30 * 60 * 1_000,
    );
  });
});

describe("buildPublicExpiresAt", () => {
  it("returns a far-future ISO date when expiresAt is 0 (no-expiry)", () => {
    const result = buildPublicExpiresAt(0);
    expect(Date.parse(result)).toBeGreaterThan(Date.now() + 365 * 24 * 60 * 60 * 1000);
  });

  it("returns the ISO date for a normal expiresAt", () => {
    const ts = 1_800_000_000_000;
    expect(buildPublicExpiresAt(ts)).toBe(new Date(ts).toISOString());
  });
});

describe("isConnectTicketExpired", () => {
  it("never expires when expiresAt is 0", () => {
    expect(isConnectTicketExpired(0, Date.now())).toBe(false);
  });

  it("is expired when expiresAt is in the past", () => {
    const now = 2_000_000;
    expect(isConnectTicketExpired(now - 1, now)).toBe(true);
  });

  it("is not expired when expiresAt is in the future", () => {
    const now = 2_000_000;
    expect(isConnectTicketExpired(now + 1, now)).toBe(false);
  });
});
