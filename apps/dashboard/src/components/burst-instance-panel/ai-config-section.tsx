"use client";

import type { AiConfigState } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export function AiConfigSection({
  provider,
  apiKey,
  model,
  onProviderChange,
  onApiKeyChange,
  onModelChange,
  configState,
  onSave,
}: {
  provider: string;
  apiKey: string;
  model: string;
  onProviderChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  configState: AiConfigState | undefined;
  onSave: () => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <NativeSelect
          value={provider}
          onChange={(event) => onProviderChange(event.target.value)}
          className="w-auto"
          aria-label="ai provider"
        >
          <option value="">Select AI provider…</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
        </NativeSelect>
        <Input
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          className="w-auto"
          aria-label="ai api key"
          placeholder="API key"
          type="password"
          style={{ minWidth: 220 }}
        />
        <Input
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="w-auto"
          aria-label="ai model"
          placeholder="Model (e.g. anthropic/claude-sonnet-4-5)"
          style={{ minWidth: 240 }}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={configState?.status === "saving"}
          onClick={() => onSave()}
        >
          {configState?.status === "saving" ? "Saving…" : "Save AI config"}
        </Button>
      </div>
      {configState?.status === "saved" ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-success)" }}>
          {configState.output ?? "AI provider configured."}
        </div>
      ) : null}
      {configState?.error ? (
        <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{configState.error}</div>
      ) : null}
    </div>
  );
}
