"use client";

import * as React from "react";
import { CircleCheck, CircleHelp, CircleX, Copy, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toolCallStatus } from "@/components/opengroow/mission-status";
import { formatDurationMs } from "@/src/lib/trace/format-trace";
import type { TraceMessageEvent, TraceToolEvent } from "@/src/lib/trace/normalize-trace";

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
      <pre className="m-0 max-h-96 min-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 font-mono text-xs text-foreground ring-1 ring-inset ring-border">
        {text}
      </pre>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Copy />
        {copied ? "Copied" : "Copy"}
      </Button>
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
    ["Status", toolCallStatus(event.status).label],
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

function StatusIcon({ status }: { status: TraceToolEvent["status"] }) {
  const { label } = toolCallStatus(status);
  if (status === "completed") return <CircleCheck aria-label={label} className="size-5 shrink-0 text-tone-green" />;
  if (status === "failed") return <CircleX aria-label={label} className="size-5 shrink-0 text-destructive" />;
  if (status === "running") return <LoaderCircle aria-label={label} className="size-5 shrink-0 animate-spin text-muted-foreground" />;
  return <CircleHelp aria-label={label} className="size-5 shrink-0 text-muted-foreground" />;
}

/** One call: its Input, then its Output, with the metadata below. */
function CallDetail({ event }: { event: TraceToolEvent }) {
  return (
    <div className="grid min-w-0 gap-4">
      {event.status === "failed" && event.error ? (
        <p className="m-0 break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{event.error}</p>
      ) : null}
      <section aria-label="Input" className="grid min-w-0 gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Input</h3>
        <PayloadPanel label="Input" text={formatPayload(event.input)} />
      </section>
      <section aria-label="Output" className="grid min-w-0 gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Output</h3>
        <PayloadPanel label="Output" text={formatPayload(event.output)} />
      </section>
      <details className="grid gap-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</summary>
        <div className="pt-2">
          <MetadataPanel event={event} />
        </div>
      </details>
    </div>
  );
}

/**
 * Inspector of one Tool Call, or of a group of parallel calls of the same tool: each call with its Input then its
 * Output, so a call and its result are read together.
 */
export function ToolInspector({ event }: { event: TraceToolEvent }) {
  const calls = event.calls;
  return (
    <aside
      className="grid min-w-0 content-start gap-4 rounded-xl bg-card p-4 ring-1 ring-inset ring-border"
      data-testid="tool-inspector"
      aria-label="Inspector"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <p className="m-0 truncate text-base font-semibold text-foreground">{calls ? `${event.name} ×${calls.length}` : event.name}</p>
          {event.server ? <p className="m-0 truncate text-sm text-muted-foreground">{event.server}</p> : null}
        </div>
        <StatusIcon status={event.status} />
      </div>
      {calls ? (
        calls.map((call, index) => (
          <section key={call.id} aria-label={`Call ${index + 1}`} className="grid min-w-0 gap-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-sm font-semibold text-foreground">{`Call ${index + 1}`}</h3>
              <StatusIcon status={call.status} />
            </div>
            <CallDetail event={call} />
          </section>
        ))
      ) : (
        <CallDetail event={event} />
      )}
    </aside>
  );
}

const MESSAGE_TABS = ["Content", "Metadata"] as const;

/** Right-side inspector of an Instruction or Agent message: its full text. */
export function MessageInspector({ event }: { event: TraceMessageEvent }) {
  const [tab, setTab] = React.useState<(typeof MESSAGE_TABS)[number]>("Content");
  const rows: [string, string | undefined][] = [
    ["Started", event.startedAt ? new Date(event.startedAt).toLocaleString() : undefined],
  ];
  return (
    <aside
      className="grid min-w-0 content-start gap-3 rounded-xl bg-card p-4 ring-1 ring-inset ring-border"
      data-testid="tool-inspector"
      aria-label="Inspector"
    >
      <h2 className="m-0 text-sm text-muted-foreground">Inspector</h2>
      <p className="m-0 truncate text-sm font-semibold text-foreground">
        {event.type === "instruction" ? "Instruction" : "Agent"}
      </p>
      <div role="tablist" className="flex gap-1">
        {MESSAGE_TABS.map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            variant={tab === t ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      {tab === "Content" ? <PayloadPanel label="Content" text={event.text || undefined} /> : null}
      {tab === "Metadata" ? (
        <dl className="m-0 grid gap-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid min-w-0 gap-0.5">
              <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
              <dd className="m-0 min-h-5 break-words text-foreground">{v ?? ""}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </aside>
  );
}
