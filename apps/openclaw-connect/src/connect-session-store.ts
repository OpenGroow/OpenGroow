function isTicketExpired(expiresAt: number, now: number): boolean {
  return expiresAt !== 0 && expiresAt <= now;
}

type ConnectTicketRef = {
  ticketId: string;
  expiresAt: number;
};

export type ConnectSessionPhase =
  | "waiting_for_device"
  | "approval_required"
  | "reconnecting"
  | "connected"
  | "failed"
  | "expired";

export type ConnectSessionSnapshot = {
  ticketId: string;
  phase: ConnectSessionPhase;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  connectedAt?: number;
  error?: string;
};

export function createConnectSessionStore({
  stableConnectedMs = 5_000,
}: {
  stableConnectedMs?: number;
} = {}) {
  const sessions = new Map<string, ConnectSessionSnapshot>();
  const stableTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function ensure(ticket: ConnectTicketRef, now = Date.now()): ConnectSessionSnapshot {
    const existing = sessions.get(ticket.ticketId);
    if (!existing) {
      const created: ConnectSessionSnapshot = {
        ticketId: ticket.ticketId,
        phase: isTicketExpired(ticket.expiresAt, now) ? "expired" : "waiting_for_device",
        createdAt: now,
        updatedAt: now,
        expiresAt: ticket.expiresAt,
      };
      sessions.set(ticket.ticketId, created);
      return created;
    }

    if (
      isTicketExpired(ticket.expiresAt, now) &&
      existing.phase !== "connected" &&
      existing.phase !== "expired"
    ) {
      cancelStableConnect(ticket.ticketId);
      const expired: ConnectSessionSnapshot = {
        ...existing,
        phase: "expired",
        updatedAt: now,
        expiresAt: ticket.expiresAt,
      };
      sessions.set(ticket.ticketId, expired);
      return expired;
    }

    if (existing.expiresAt !== ticket.expiresAt) {
      const refreshed: ConnectSessionSnapshot = {
        ...existing,
        expiresAt: ticket.expiresAt,
      };
      sessions.set(ticket.ticketId, refreshed);
      return refreshed;
    }

    return existing;
  }

  function setPhase(
    ticket: ConnectTicketRef,
    phase: ConnectSessionPhase,
    {
      now = Date.now(),
      error,
      connectedAt,
    }: {
      now?: number;
      error?: string;
      connectedAt?: number;
    } = {},
  ): ConnectSessionSnapshot {
    const current = ensure(ticket, now);
    if (phase === "connected" || phase === "failed" || phase === "expired") {
      cancelStableConnect(ticket.ticketId);
    }

    const next: ConnectSessionSnapshot = {
      ...current,
      phase,
      updatedAt: now,
      expiresAt: ticket.expiresAt,
      error,
      connectedAt:
        connectedAt ?? (phase === "connected" ? now : current.connectedAt),
    };
    sessions.set(ticket.ticketId, next);
    return next;
  }

  function beginStableConnect(
    ticket: ConnectTicketRef,
    now = Date.now(),
  ): ConnectSessionSnapshot {
    const current = ensure(ticket, now);
    if (current.phase === "connected" || current.phase === "expired") {
      return current;
    }

    const next = setPhase(ticket, "reconnecting", { now });
    cancelStableConnect(ticket.ticketId);

    const timer = setTimeout(() => {
      const latest = sessions.get(ticket.ticketId);
      if (!latest) {
        return;
      }
      if (
        latest.phase === "reconnecting" ||
        latest.phase === "waiting_for_device"
      ) {
        setPhase(ticket, "connected", {
          now: now + stableConnectedMs,
          connectedAt: now + stableConnectedMs,
        });
      }
    }, stableConnectedMs);
    timer.unref?.();
    stableTimers.set(ticket.ticketId, timer);

    return next;
  }

  function cancelStableConnect(ticketId: string): void {
    const timer = stableTimers.get(ticketId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    stableTimers.delete(ticketId);
  }

  function get(ticket: ConnectTicketRef, now = Date.now()): ConnectSessionSnapshot {
    return ensure(ticket, now);
  }

  function destroy(): void {
    for (const timer of stableTimers.values()) {
      clearTimeout(timer);
    }
    stableTimers.clear();
    sessions.clear();
  }

  return {
    beginStableConnect,
    cancelStableConnect,
    destroy,
    get,
    setPhase,
  };
}
