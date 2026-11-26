"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDurationMs } from "@/src/lib/trace/format-trace";
import type { TraceToolEvent } from "@/src/lib/trace/normalize-trace";

const TABS = ["Input", "Output", "Metadata"] as const;
type Tab = (typeof TABS)[number];

/** JSON for objects, raw text for strings; undefined when there is no payload. */
export function formatPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PayloadPanel({ label, text }: { label: string; text?: string }) {
  const [copied, setCopied] = React.useState(false);
  if (text === undefined) return <p className="m-0 text-sm text-muted-foreground">No {label.toLowerCase()} recorded.</p>;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-end gap-2">
        {copied ? (
          <span className="text-xs text-muted-foreground" role="status">
            Copied
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          Copy
        </Button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
        {text}
      </pre>
    </div>
  );
}

function MetadataPanel({ event }: { event: TraceToolEvent }) {
  const rows: [string, string | undefined][] = [
    ["Tool call id", event.toolCallId],
    ["Tool", event.name],
    ["MCP server", event.server],
    ["Started", event.startedAt ? new Date(event.startedAt).toLocaleString() : undefined],
    ["Ended", event.endedAt ? new Date(event.endedAt).toLocaleString() : undefined],
    ["Observed duration", formatDurationMs(event.observedDurationMs)],
    ["Status", event.status],
    ["Error", event.error],
  ];
  return (
    <dl className="m-0 grid gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid min-w-0 gap-0.5">
          <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
          <dd className="m-0 min-h-5 break-words text-foreground">{v ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Right-side inspector of one Tool Call: full Input, Output and Metadata. */
export function ToolInspector({ event }: { event: TraceToolEvent }) {
  const [tab, setTab] = React.useState<Tab>("Input");
  return (
    <aside
      className="grid min-w-0 content-start gap-3 rounded-xl p-4 ring-1 ring-inset ring-border"
      data-testid="tool-inspector"
      aria-label="Tool call inspector"
    >
      <h2 className="m-0 truncate text-sm font-semibold">{event.name}</h2>
      {event.status === "failed" && event.error ? (
        <p className="m-0 break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{event.error}</p>
      ) : null}
      <div role="tablist" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "rounded-md px-3 py-1 text-sm",
              tab === t ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Input" ? <PayloadPanel label="Input" text={formatPayload(event.input)} /> : null}
      {tab === "Output" ? <PayloadPanel label="Output" text={formatPayload(event.output)} /> : null}
      {tab === "Metadata" ? <MetadataPanel event={event} /> : null}
    </aside>
  );
}
