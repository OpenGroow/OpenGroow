"use client";

import type { ConnectTicketState } from "./types";
import { Button } from "@/components/ui/button";

export function ConnectTicketSection({
  connectState,
}: {
  connectState: ConnectTicketState | undefined;
}) {
  if (!connectState) {
    return null;
  }
  return (
    <div style={{ marginTop: 8 }}>
      {connectState.status === "creating" ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
          Creating public connect ticket…
        </div>
      ) : null}
      {connectState.error ? (
        <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{connectState.error}</div>
      ) : null}
      {connectState.ticket ? (
        <div style={{ marginTop: 6, fontSize: 12, display: "grid", gap: 6 }}>
          <div style={{ color: "var(--status-success)" }}>
            Connect ticket ready until {new Date(connectState.ticket.expiresAt).toLocaleString()}.
          </div>
          <div>Run this exact command on the browser machine:</div>
          <div>
            <code style={{ display: "block", whiteSpace: "pre-wrap" }}>
              {connectState.ticket.nodeRunCommand}
            </code>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(connectState.ticket?.nodeRunCommand ?? "")
              }
              style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--border)" }}
>
              Copy helper command
            </Button>
          </div>
          <div style={{ color: "var(--status-warning)" }}>
            Keep this command running, then approve the pending device from the dashboard.
          </div>
        </div>
      ) : null}
    </div>
  );
}
