import * as React from "react";
import { cn } from "@/lib/utils";
import { formatDurationMs, previewPayload } from "@/src/lib/trace/format-trace";
import type { ToolCallStatus, TraceEvent, TraceToolEvent } from "@/src/lib/trace/normalize-trace";

const STATUS_STYLE: Record<ToolCallStatus, string> = {
  running: "bg-status-warning/15 text-status-warning",
  completed: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

export type TraceTimelineProps = {
  events: readonly TraceEvent[];
  /**
   * Extension points, all optional so tickets can add behavior without
   * touching the layout:
   * - #202 inspector: `onSelectTool` + `selectedEventId` make a Tool Call row selectable.
   * - #203 handoff: `renderToolBadge` adds a label (e.g. "External Job started") to a Tool Call.
   */
  onSelectTool?: (event: TraceToolEvent) => void;
  selectedEventId?: string;
  renderToolBadge?: (event: TraceToolEvent) => React.ReactNode;
};

/** Waterfall of Trace Events in transcript order; payloads are truncated previews only. */
export function TraceTimeline({ events, onSelectTool, selectedEventId, renderToolBadge }: TraceTimelineProps) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0" aria-label="Trace timeline" data-testid="trace-timeline">
      {events.map((event) => (
        <li key={event.id} data-testid={`trace-event-${event.type}`}>
          {event.type === "tool" ? (
            <ToolRow
              event={event}
              selected={selectedEventId === event.id}
              onSelect={onSelectTool}
              badge={renderToolBadge?.(event)}
            />
          ) : (
            <MessageRow event={event} />
          )}
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
      <p className="m-0 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">
        {previewPayload(event.text, 300)}
      </p>
    </div>
  );
}

function ToolRow({
  event,
  selected,
  onSelect,
  badge,
}: {
  event: TraceToolEvent;
  selected: boolean;
  onSelect?: (event: TraceToolEvent) => void;
  badge?: React.ReactNode;
}) {
  const failed = event.status === "failed";
  const duration = formatDurationMs(event.observedDurationMs);
  const inputPreview = previewPayload(event.input);
  const outputPreview = previewPayload(failed ? event.error : event.output);
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">{event.name}</span>
        {event.server ? <span className="text-xs text-muted-foreground">{event.server}</span> : null}
        {badge}
        <span
          className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[event.status])}
          data-testid="tool-status"
        >
          {event.status}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {time(event.startedAt) ? <span>{time(event.startedAt)}</span> : null}
          {duration ? <span title="Observed duration">{duration}</span> : null}
        </span>
      </div>
      {inputPreview ? <p className="m-0 truncate font-mono text-xs text-muted-foreground">in: {inputPreview}</p> : null}
      {outputPreview ? (
        <p className={cn("m-0 truncate font-mono text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          out: {outputPreview}
        </p>
      ) : null}
    </>
  );
  const frame = cn(
    "grid w-full gap-1 rounded-xl border-l-4 bg-status-warning/10 px-4 py-3 text-left ring-1 ring-inset ring-border",
    failed ? "border-destructive" : "border-status-warning",
    selected && "ring-2 ring-primary",
  );
  return onSelect ? (
    <button type="button" className={frame} onClick={() => onSelect(event)}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}
