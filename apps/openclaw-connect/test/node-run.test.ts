import { describe, expect, it } from "vitest";
import {
  buildDeviceSignatureRotationExhaustedMessage,
  decideSupervisorAction,
  hasExhaustedDeviceSignatureRotations,
  isConnectTicketExpiredOutcome,
  isInvalidDeviceSignatureOutcome,
  MAX_INVALID_DEVICE_SIGNATURE_ROTATIONS,
  type AttemptOutcome,
} from "../src/node-run-supervisor";
import {
  isPairingRequiredCloseReason,
  normalizeWebSocketCloseCode,
} from "../src/ws-utils";

const NOW = 1_000_000;

function upstreamCloseOutcome(
  overrides: Partial<Extract<AttemptOutcome, { kind: "upstream_close" }>> = {},
): AttemptOutcome {
  return {
    kind: "upstream_close",
    stable: false,
    localClientConnected: true,
    code: 1000,
    reason: "",
    ...overrides,
  };
}

describe("node-run pairing supervision", () => {
  it("normalizes reserved and invalid WebSocket close codes before relaying", () => {
    expect(normalizeWebSocketCloseCode(1000)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1008)).toBe(1008);
    expect(normalizeWebSocketCloseCode(4001)).toBe(4001);
    expect(normalizeWebSocketCloseCode(1006)).toBe(1011);
    expect(normalizeWebSocketCloseCode(undefined)).toBe(1011);
  });

  it("enters waiting mode on a pairing-required relay close", () => {
    expect(isPairingRequiredCloseReason("pairing required")).toBe(true);

    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        code: 1008,
        reason: "[openclaw] Pairing required",
      }),
      now: NOW,
      pairingWaitDeadlineAt: null,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toMatchObject({
      type: "retry",
      nextPhase: "waiting_for_approval",
      pairingWaitDeadlineAt: NOW + 120_000,
      sleepMs: 3_000,
    });
    expect(action.message).toContain("Dashboard > Devices");
  });

  it("also enters waiting mode on an early normal relay close after the local client connected", () => {
    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        code: 1000,
        reason: "Relay closed",
        localClientConnected: true,
        stable: false,
      }),
      now: NOW,
      pairingWaitDeadlineAt: null,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toMatchObject({
      type: "retry",
      nextPhase: "waiting_for_approval",
      pairingWaitDeadlineAt: NOW + 120_000,
      sleepMs: 3_000,
    });
  });

  it("retries while still inside the pairing approval window", () => {
    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        code: 1000,
        reason: "",
      }),
      now: NOW + 5_000,
      pairingWaitDeadlineAt: NOW + 20_000,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toMatchObject({
      type: "retry",
      nextPhase: "retrying",
      pairingWaitDeadlineAt: NOW + 20_000,
      sleepMs: 3_000,
    });
    expect(action.message).toContain("Still waiting for openclaw:connect:run");
  });

  it("keeps retrying on repeated pairing-required closes inside the approval window", () => {
    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        code: 1008,
        reason: "pairing required",
      }),
      now: NOW + 5_000,
      pairingWaitDeadlineAt: NOW + 20_000,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toMatchObject({
      type: "retry",
      nextPhase: "retrying",
      pairingWaitDeadlineAt: NOW + 20_000,
      sleepMs: 3_000,
    });
  });

  it("times out once the pairing approval deadline is reached", () => {
    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        code: 1000,
      }),
      now: NOW + 120_001,
      pairingWaitDeadlineAt: NOW + 120_000,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toEqual({
      type: "timeout",
      nextPhase: "timed_out",
      message:
        "Timed out after 2min — openclaw:connect:run did not connect. Generate a new connect link and try again. (If this is a new device, approve it in Dashboard > Devices first.)",
    });
  });

  it("fails immediately on non-retryable relay errors", () => {
    const action = decideSupervisorAction({
      outcome: {
        kind: "upstream_error",
        stable: false,
        localClientConnected: false,
        error: "Unexpected server response: 503",
      },
      now: NOW,
      pairingWaitDeadlineAt: null,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toEqual({
      type: "fail",
      nextPhase: "failed",
      message: "Upstream relay error: Unexpected server response: 503",
    });
  });

  it("detects a stale device signature that requires identity rotation", () => {
    const outcome = upstreamCloseOutcome({
      code: 1008,
      reason: "device signature invalid",
    });

    expect(isInvalidDeviceSignatureOutcome(outcome)).toBe(true);
    expect(
      isInvalidDeviceSignatureOutcome(
        upstreamCloseOutcome({ code: 1008, reason: "pairing required" }),
      ),
    ).toBe(false);
  });

  it("treats a closed relay session as permanently expired when the connect ticket is gone", () => {
    const outcome = upstreamCloseOutcome({
      code: 1008,
      reason: "Connect ticket expired",
    });

    expect(isConnectTicketExpiredOutcome(outcome)).toBe(true);
    expect(
      isConnectTicketExpiredOutcome(
        upstreamCloseOutcome({ code: 1008, reason: "device signature expired" }),
      ),
    ).toBe(false);
  });

  it("treats an upgrade rejection as a permanently expired connect ticket", () => {
    expect(
      isConnectTicketExpiredOutcome({
        kind: "upstream_error",
        stable: false,
        localClientConnected: false,
        error: "Unexpected server response: 404",
      }),
    ).toBe(true);
    expect(
      isConnectTicketExpiredOutcome({
        kind: "upstream_error",
        stable: false,
        localClientConnected: false,
        error: "Unexpected server response: 503",
      }),
    ).toBe(false);
  });

  it("keeps rotating while under the max consecutive invalid-signature count", () => {
    for (let n = 1; n <= MAX_INVALID_DEVICE_SIGNATURE_ROTATIONS; n += 1) {
      expect(hasExhaustedDeviceSignatureRotations(n)).toBe(false);
    }
  });

  it("stops rotating once the max consecutive invalid-signature count is exceeded", () => {
    // Live incident: Docker Desktop's VM clock lagged behind the host after it woke
    // from sleep, so every fresh identity's signature was rejected the same way —
    // rotateInvalidLocalNodeIdentity looped ~10 times in 35 minutes without ever
    // recovering, since a new identity's signature is derived from the same skewed
    // clock. This must give up loudly instead of burning through identities forever.
    expect(
      hasExhaustedDeviceSignatureRotations(MAX_INVALID_DEVICE_SIGNATURE_ROTATIONS + 1),
    ).toBe(true);
  });

  it("explains the likely clock-skew cause when rotations are exhausted", () => {
    const message = buildDeviceSignatureRotationExhaustedMessage(4);
    expect(message).toContain("4 times in a row");
    expect(message).toContain("clock skew");
  });

  it("treats a stable normal relay close as a successful connected session", () => {
    const action = decideSupervisorAction({
      outcome: upstreamCloseOutcome({
        stable: true,
        code: 1000,
        reason: "Relay closed",
      }),
      now: NOW,
      pairingWaitDeadlineAt: NOW + 20_000,
      pairingWaitMs: 120_000,
      pairingRetryMs: 3_000,
    });

    expect(action).toEqual({
      type: "finish",
      nextPhase: "connected",
      exitCode: 0,
      message: "Gateway relay closed normally: Relay closed",
    });
  });
});
