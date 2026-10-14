"use client";

import { buttonChipClass, inputChipClass } from "./styles";
import type { TelegramConfigState } from "./types";

export function TelegramSection({
  botToken,
  onBotTokenChange,
  configState,
  onSave,
}: {
  botToken: string;
  onBotTokenChange: (value: string) => void;
  configState: TelegramConfigState | undefined;
  onSave: () => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={botToken}
          onChange={(event) => onBotTokenChange(event.target.value)}
          className={inputChipClass}
          aria-label="telegram bot token"
          placeholder="Telegram bot token (from @BotFather)"
          style={{ minWidth: 280 }}
          type="password"
        />
        <button
          className={buttonChipClass}
          type="button"
          disabled={configState?.status === "saving"}
          onClick={() => onSave()}
        >
          {configState?.status === "saving" ? "Saving…" : "Save Telegram token"}
        </button>
      </div>
      {configState?.status === "saved" ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#1e7f5c" }}>
          {configState.output ?? "Telegram bot configured."}
        </div>
      ) : null}
      {configState?.error ? (
        <div style={{ color: "#9d1f2f", marginTop: 6, fontSize: 12 }}>{configState.error}</div>
      ) : null}
    </div>
  );
}
