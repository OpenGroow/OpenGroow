"use client";

import type { TelegramConfigState } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        <Input
          value={botToken}
          onChange={(event) => onBotTokenChange(event.target.value)}
          className="w-auto"
          aria-label="telegram bot token"
          placeholder="Telegram bot token (from @BotFather)"
          style={{ minWidth: 280 }}
          type="password"
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={configState?.status === "saving"}
          onClick={() => onSave()}
        >
          {configState?.status === "saving" ? "Saving…" : "Save Telegram token"}
        </Button>
      </div>
      {configState?.status === "saved" ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-success)" }}>
          {configState.output ?? "Telegram bot configured."}
        </div>
      ) : null}
      {configState?.error ? (
        <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{configState.error}</div>
      ) : null}
    </div>
  );
}
