"use client";

import { preClass } from "./styles";
import type { WhatsAppConfigState, WhatsAppPairingState } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WhatsAppSection({
  number,
  onNumberChange,
  configState,
  pairing,
  onPairStart,
  onPairWait,
  onConfigSet,
}: {
  number: string;
  onNumberChange: (value: string) => void;
  configState: WhatsAppConfigState | undefined;
  pairing: WhatsAppPairingState | undefined;
  onPairStart: (force?: boolean) => void;
  onPairWait: () => void;
  onConfigSet: () => void;
}) {
  const whatsAppReady = pairing?.connected || pairing?.linked;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outline" size="sm"  type="button" onClick={() => onPairStart()}>
          Pair WhatsApp
        </Button>
        <Button variant="outline" size="sm"  type="button" onClick={() => onPairStart(true)}>
          New QR
        </Button>
        <Button variant="outline" size="sm"  type="button" onClick={() => onPairWait()}>
          Check WhatsApp link
        </Button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <Input
          value={number}
          onChange={(event) => onNumberChange(event.target.value)}
          className="w-auto"
          aria-label="whatsapp number"
          placeholder="+33612345678 (auto-applied after pairing)"
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={
            configState?.status === "saving" ||
            (number.trim().length > 0 && !whatsAppReady)
          }
          onClick={() => onConfigSet()}
        >
          Save WhatsApp number
        </Button>
      </div>
      {!configState ? (
        whatsAppReady || !number.trim() ? null : (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--status-warning)" }}>
            Link WhatsApp first. The number will be auto-applied once the session is available.
          </div>
        )
      ) : (
        <div style={{ marginTop: 8 }}>
          {configState.status === "saving" ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Saving WhatsApp DM policy on the gateway…
            </div>
          ) : null}
          {configState.output ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{configState.output}</div>
          ) : null}
          {configState.error ? (
            <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{configState.error}</div>
          ) : null}
          {!whatsAppReady && number.trim() ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Link WhatsApp first. The number will be auto-applied once the session is available.
            </div>
          ) : null}
        </div>
      )}
      {pairing ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>WhatsApp: {pairing.status ?? "idle"}</div>
          {pairing.status === "starting" || pairing.status === "restarting" ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Generating a WhatsApp QR on the gateway…
            </div>
          ) : null}
          {pairing.status === "checking" ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Checking whether WhatsApp is linked…
            </div>
          ) : null}
          {pairing.status === "qr_ready" || pairing.status === "waiting_scan" ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Open WhatsApp, go to Linked Devices, and scan the QR. This panel will keep checking automatically.
            </div>
          ) : null}
          {pairing.connected ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-success)" }}>
              WhatsApp connected on this gateway.
            </div>
          ) : null}
          {pairing.linked && !pairing.connected ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              WhatsApp is linked, but the session is currently disconnected.
            </div>
          ) : null}
          {pairing.output ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{pairing.output}</div>
          ) : null}
          {pairing.error ? (
            <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{pairing.error}</div>
          ) : null}
          {pairing.qrDataUrl ? (
            <div style={{ marginTop: 8 }}>
              <img
                src={pairing.qrDataUrl}
                alt="WhatsApp QR"
                style={{
                  width: 220,
                  height: 220,
                  objectFit: "contain",
                  background: "#fff",
                  borderRadius: 12,
                  padding: 10
                }}
              />
            </div>
          ) : null}
          {pairing.output ? <pre className={preClass}>{pairing.output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
