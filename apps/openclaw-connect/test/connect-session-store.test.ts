import { describe, expect, it, vi, afterEach } from "vitest";
import { createConnectSessionStore } from "../src/connect-session-store";

const TICKET = {
  ticketId: "ticket-1",
  expiresAt: 200_000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("connect session store", () => {
  it("starts in waiting_for_device", () => {
    const store = createConnectSessionStore();

    expect(store.get(TICKET, 100_000)).toMatchObject({
      ticketId: "ticket-1",
      phase: "waiting_for_device",
      expiresAt: 200_000,
    });
  });

  it("moves to approval_required and reconnecting", () => {
    const store = createConnectSessionStore();

    store.setPhase(TICKET, "approval_required", { now: 101_000 });
    expect(store.get(TICKET, 101_500).phase).toBe("approval_required");

    store.beginStableConnect(TICKET, 102_000);
    expect(store.get(TICKET, 102_500).phase).toBe("reconnecting");
  });

  it("promotes reconnecting to connected after the stable window", () => {
    vi.useFakeTimers();
    const store = createConnectSessionStore({ stableConnectedMs: 5_000 });

    store.beginStableConnect(TICKET, 100_000);
    vi.advanceTimersByTime(4_999);
    expect(store.get(TICKET, 104_999).phase).toBe("reconnecting");

    vi.advanceTimersByTime(1);
    expect(store.get(TICKET, 105_000)).toMatchObject({
      phase: "connected",
      connectedAt: 105_000,
    });
  });

  it("keeps failed as terminal instead of promoting to connected", () => {
    vi.useFakeTimers();
    const store = createConnectSessionStore({ stableConnectedMs: 5_000 });

    store.beginStableConnect(TICKET, 100_000);
    store.setPhase(TICKET, "failed", {
      now: 101_000,
      error: "broker relay failed",
    });

    vi.advanceTimersByTime(5_000);
    expect(store.get(TICKET, 106_000)).toMatchObject({
      phase: "failed",
      error: "broker relay failed",
    });
  });

  it("marks non-connected sessions as expired after the ticket deadline", () => {
    const store = createConnectSessionStore();

    store.setPhase(TICKET, "approval_required", { now: 150_000 });
    expect(store.get(TICKET, 200_001).phase).toBe("expired");
  });
});
