import { StatusBadge } from "@/components/opengroow/status-badge";
import { toolCallStatus } from "@/components/opengroow/mission-status";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";
import { cn } from "@/lib/utils";
import { formatDurationMs, previewPayload } from "@/src/lib/trace/format-trace";
import type { TraceEvent, TraceToolEvent } from "@/src/lib/trace/normalize-trace";

/** Trace Events in transcript order as plain rows: tool, server, start, Observed duration, status, truncated previews. */
export function TraceList({ events }: { events: readonly TraceEvent[] }) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0" aria-label="Run activity" data-testid="trace-list">
      {events.map((event) => (
        <li key={event.id} data-testid={`trace-event-${event.type}`}>
          {event.type === "tool" ? <ToolRow event={event} /> : <MessageRow event={event} />}
        </li>
      ))}
    </ol>
  );
}

function time(iso?: string) {
  return iso ? new Date(iso).toLocaleTimeString() : undefined;
}

function MessageRow({ event }: { event: Extract<TraceEvent, { type: "instruction" | "agent" }> }) {
  const instruction = event.type === "instruction";
  return (
    <div className={cn("grid gap-1 rounded-xl px-4 py-3 ring-1 ring-inset ring-border", instruction ? "bg-muted" : "bg-background")}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-muted-foreground">{instruction ? "Instruction" : "Agent message"}</span>
        <span className="text-muted-foreground">{time(event.startedAt)}</span>
      </div>
      {instruction ? (
        <p className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm text-foreground">{event.text}</p>
      ) : (
        <div className="max-h-60 overflow-auto text-sm">
          <WorkspaceMarkdown content={event.text ?? ""} />
        </div>
      )}
    </div>
  );
}

function fullPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function ToolRow({ event }: { event: TraceToolEvent }) {
  const failed = event.status === "failed";
  const status = toolCallStatus(event.status);
  const duration = formatDurationMs(event.observedDurationMs);
  const inputPreview = previewPayload(event.input);
  const outputPreview = previewPayload(failed ? event.error : event.output);
  const input = fullPayload(event.input);
  const output = fullPayload(failed ? event.error : event.output);
  return (
    <details
      className={cn(
        "group grid gap-1 rounded-xl border-l-4 px-4 py-3 ring-1 ring-inset ring-border",
        failed ? "border-destructive bg-destructive/5" : "border-border",
      )}
    >
      <summary className="grid cursor-pointer list-none gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">{event.name}</span>
          {event.server ? <span className="text-xs text-muted-foreground">{event.server}</span> : null}
          <span data-testid="tool-status">
            <StatusBadge tone={status.tone} label={status.label} />
          </span>
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {time(event.startedAt) ? <span>{time(event.startedAt)}</span> : null}
            {duration ? <span title="Observed duration">{duration}</span> : null}
          </span>
        </div>
        <span className="group-open:hidden">
          {inputPreview ? <p className="m-0 truncate font-mono text-xs text-muted-foreground">in: {inputPreview}</p> : null}
          {outputPreview ? (
            <p className={cn("m-0 truncate font-mono text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
              out: {outputPreview}
            </p>
          ) : null}
        </span>
      </summary>
      <div className="mt-2 grid gap-2">
        {input ? <PayloadBlock label="Input" text={input} /> : null}
        {output ? <PayloadBlock label={failed ? "Error" : "Output"} text={output} tone={failed ? "error" : undefined} /> : null}
      </div>
    </details>
  );
}

function PayloadBlock({ label, text, tone }: { label: string; text: string; tone?: "error" }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <pre
        className={cn(
          "m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs",
          tone === "error" ? "text-destructive" : "text-foreground",
        )}
      >
        {text}
      </pre>
    </div>
  );
}
