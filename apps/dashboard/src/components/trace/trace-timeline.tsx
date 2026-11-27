import * as React from "react";
import { Code, MessageCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { toolCallStatus } from "@/components/opengroow/mission-status";
import { cn } from "@/lib/utils";
import { formatDurationMs, previewPayload } from "@/src/lib/trace/format-trace";
import type { TraceEvent, TraceMessageEvent, TraceToolEvent } from "@/src/lib/trace/normalize-trace";
import { computeTimelineLayout, type TimelineBar } from "@/src/lib/trace/timeline-layout";

export type TraceTimelineProps = {
  events: readonly TraceEvent[];
  /**
   * Extension points, all optional so tickets can add behavior without
   * touching the layout:
   * - #202 inspector: `onSelectTool` + `selectedEventId` make a Tool Call row selectable.
   * - #203 handoff: `renderToolBadge` adds a label (e.g. "External Job started") to a Tool Call.
   */
  onSelectTool?: (event: TraceToolEvent) => void;
  /** Makes Instruction and Agent message rows selectable, like Tool Call rows. */
  onSelectMessage?: (event: TraceMessageEvent) => void;
  selectedEventId?: string;
  renderToolBadge?: (event: TraceToolEvent) => React.ReactNode;
};

const GRIDLINES = [0, 25, 50, 75, 100];
const ROW_GRID = "grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-3";

type Kind = "message" | "file" | "mcp";

function kindOf(event: TraceEvent): Kind {
  if (event.type !== "tool") return "message";
  return event.server ? "mcp" : "file";
}

const KIND_ICON = { message: MessageCircle, file: Code, mcp: Plug } as const;
const KIND_BAR = { message: "bg-tone-slate", file: "bg-tone-blue", mcp: "bg-tone-violet" } as const;

/** The file a file Tool Call targets (basename of its path argument), when the input carries one. */
function fileTarget(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "file", "filename"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value.split("/").filter(Boolean).pop();
  }
  return undefined;
}

function axisLabel(ms: number | undefined): string {
  return ms === undefined ? "" : (formatDurationMs(ms) ?? "");
}

/** Waterfall of Trace Events in transcript order; payloads are truncated previews only. */
export function TraceTimeline({ events, onSelectTool, onSelectMessage, selectedEventId, renderToolBadge }: TraceTimelineProps) {
  const layout = React.useMemo(() => computeTimelineLayout(events), [events]);
  return (
    <div className="grid min-w-0 gap-1">
      <div className={cn(ROW_GRID, "px-3 pb-1 text-sm text-muted-foreground")} aria-hidden="true">
        <span>Execution</span>
        <div className="flex items-center justify-between">
          <span>{layout.totalMs === undefined ? "" : "0 s"}</span>
          <span>{axisLabel(layout.totalMs)}</span>
        </div>
      </div>
      <ol className="m-0 grid list-none gap-1 p-0" aria-label="Trace timeline" data-testid="trace-timeline">
        {events.map((event) => (
          <li key={event.id} data-testid={`trace-event-${event.type}`}>
            {event.type === "tool" ? (
              <ToolRow
                event={event}
                bar={layout.bars.get(event.id)}
                selected={selectedEventId === event.id}
                onSelect={onSelectTool}
                badge={renderToolBadge?.(event)}
              />
            ) : (
              <MessageRow
                event={event}
                bar={layout.bars.get(event.id)}
                selected={selectedEventId === event.id}
                onSelect={onSelectMessage}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Lane({ bar, kind, failed }: { bar?: TimelineBar; kind: Kind; failed: boolean }) {
  return (
    <div className="relative h-8 min-w-0" aria-hidden="true">
      {GRIDLINES.map((pct) => (
        <span
          key={pct}
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${pct === 100 ? 99.8 : pct}%` }}
        />
      ))}
      {bar ? (
        <span
          data-testid="trace-bar"
          className={cn("absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full", failed ? "bg-destructive" : KIND_BAR[kind])}
          style={{ left: `${bar.offsetPct}%`, width: `${bar.widthPct}%` }}
        />
      ) : null}
    </div>
  );
}

function Label({ kind, small, main }: { kind: Kind; small?: string; main: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="grid min-w-0 text-left leading-tight">
        <span className="truncate text-xs text-muted-foreground">{small}</span>
        <span className="truncate text-sm text-foreground">{main}</span>
      </div>
    </div>
  );
}

function MessageRow({
  event,
  bar,
  selected,
  onSelect,
}: {
  event: TraceMessageEvent;
  bar?: TimelineBar;
  selected: boolean;
  onSelect?: (event: TraceMessageEvent) => void;
}) {
  const body = (
    <>
      <Label
        kind="message"
        small={previewPayload(event.text, 80)}
        main={event.type === "instruction" ? "Instruction" : "Agent"}
      />
      <Lane bar={bar} kind="message" failed={false} />
    </>
  );
  const frame = cn("rounded-lg px-3 py-1", selected ? "bg-muted" : "hover:bg-muted/50");
  return onSelect ? (
    <Button
      type="button"
      variant="ghost"
      className={cn(frame, ROW_GRID, "h-auto w-full justify-stretch whitespace-normal font-normal")}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      {body}
    </Button>
  ) : (
    <div className={cn(ROW_GRID, "rounded-lg px-3 py-1")}>{body}</div>
  );
}

function ToolRow({
  event,
  bar,
  selected,
  onSelect,
  badge,
}: {
  event: TraceToolEvent;
  bar?: TimelineBar;
  selected: boolean;
  onSelect?: (event: TraceToolEvent) => void;
  badge?: React.ReactNode;
}) {
  const failed = event.status === "failed";
  const kind = kindOf(event);
  const status = toolCallStatus(event.status);
  const duration = formatDurationMs(event.observedDurationMs);
  const outputPreview = failed ? previewPayload(event.error, 120) : undefined;
  const main = kind === "mcp" ? event.server! : (fileTarget(event.input) ?? event.name);
  const count = event.calls?.length;
  const frame = cn("rounded-lg px-3 py-1", selected ? "bg-muted" : "hover:bg-muted/50");
  const body = (
    <>
      <div className="grid min-w-0 gap-0.5">
        <Label kind={kind} small={event.name} main={main} />
        {badge || count || failed || event.status === "running" || duration ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
            {count ? <span data-testid="parallel-calls" className="rounded-full bg-muted px-2 py-0.5 font-semibold tabular-nums text-foreground">{`×${count}`}</span> : null}
            {badge}
            {event.status === "completed" ? null : (
              <span data-testid="tool-status">
                <StatusBadge tone={status.tone} label={status.label} />
              </span>
            )}
            {duration ? <span title="Observed duration">{duration}</span> : null}
          </div>
        ) : null}
        {outputPreview ? <p className="m-0 truncate pl-5 font-mono text-xs text-destructive">{outputPreview}</p> : null}
      </div>
      <Lane bar={bar} kind={kind} failed={failed} />
    </>
  );
  return onSelect ? (
    <Button
      type="button"
      variant="ghost"
      className={cn(frame, ROW_GRID, "h-auto w-full justify-stretch whitespace-normal font-normal")}
      aria-pressed={selected}
      title={previewPayload(event.input)}
      onClick={() => onSelect(event)}
    >
      {body}
    </Button>
  ) : (
    <div className={cn(frame, ROW_GRID)}>{body}</div>
  );
}
