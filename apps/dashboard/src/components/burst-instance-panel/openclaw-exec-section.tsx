"use client";

import { preClass } from "./styles";
import type { OpenClawCommandState } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OpenClawExecSection({
  command,
  onCommandChange,
  commandState,
  onRun,
}: {
  command: string;
  onCommandChange: (value: string) => void;
  commandState: OpenClawCommandState | undefined;
  onRun: () => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          className="w-auto"
          aria-label="openclaw cli command"
          placeholder="channels status --probe --json"
          style={{ minWidth: 320 }}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={commandState?.status === "running"}
          onClick={() => onRun()}
        >
          Run OpenClaw CLI
        </Button>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Allowed roots: channels, config, pairing, doctor, logs, help, nodes, browser
      </div>
      {commandState ? (
        <div style={{ marginTop: 8 }}>
          {commandState.status === "running" ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--status-warning)" }}>
              Running OpenClaw command on the gateway…
            </div>
          ) : null}
          {commandState.error ? (
            <div style={{ color: "var(--status-error)", marginTop: 6, fontSize: 12 }}>{commandState.error}</div>
          ) : null}
          {commandState.output ? <pre className={preClass}>{commandState.output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
