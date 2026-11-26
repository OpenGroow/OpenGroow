import type { SessionTranscriptTurn } from "@/src/components/workspace-logs.types";

/**
 * Pure normalization of a Run's session transcript into Trace Events (PRD
 * docs/prd/agent-execution-trace.md). No React, no Convex. A call and its
 * result are grouped ONLY through their native `toolCallId`; nothing is guessed
 * from the tool name.
 */

export type ToolCallStatus = "running" | "completed" | "failed" | "unknown";

type BaseEvent = {
  /** Stable id: `${runId}:${index of the first turn of the event}`. */
  id: string;
  runId: string;
  startedAt?: string;
  endedAt?: string;
};

export type TraceMessageEvent = BaseEvent & { type: "instruction" | "agent"; text: string };

export type TraceToolEvent = BaseEvent & {
  type: "tool";
  /** Tool name without its MCP server prefix. */
  name: string;
  server?: string;
  toolCallId?: string;
  status: ToolCallStatus;
  /** End minus start from the transcript's own timestamps; undefined when one is missing. */
  observedDurationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  /**
   * Extension point (#203): a later pass that knows the Run's `mcpJob` sets
   * this. Always false from `normalizeTrace`.
   */
  externalJobHandoff: boolean;
};

export type TraceEvent = TraceMessageEvent | TraceToolEvent;

/** The part of a Run the normalization needs. #203 adds `mcpJob` here. */
export type TraceRunInfo = { id: string; status: string };

export const TERMINAL_RUN_STATUSES: readonly string[] = ["completed", "resumed", "failed", "cancelled"];
export const isTerminalRunStatus = (status: string): boolean => TERMINAL_RUN_STATUSES.includes(status);

/** `media-mcp__tool` or `media.tool` give a server; `read`/`write`/`edit` have none. */
export function splitToolName(toolName: string): { server?: string; name: string } {
  for (const sep of ["__", "."]) {
    const i = toolName.indexOf(sep);
    if (i > 0 && i + sep.length < toolName.length) {
      return { server: toolName.slice(0, i), name: toolName.slice(i + sep.length) };
    }
  }
  return { name: toolName };
}

function durationMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isNaN(ms) || ms < 0 ? undefined : ms;
}

function errorText(value: unknown): string {
  if (value === undefined || value === null) return "Tool call failed";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function normalizeTrace(turns: readonly SessionTranscriptTurn[], run: TraceRunInfo): TraceEvent[] {
  const terminal = isTerminalRunStatus(run.status);
  const events: TraceEvent[] = [];
  const openCalls = new Map<string, TraceToolEvent>();

  turns.forEach((turn, index) => {
    const id = `${run.id}:${index}`;
    if (turn.kind === undefined || turn.kind === "message") {
      events.push({
        id,
        runId: run.id,
        type: turn.role === "user" ? "instruction" : "agent",
        text: turn.text,
        startedAt: turn.timestamp,
      });
      return;
    }
    if (turn.kind === "tool_call") {
      const event: TraceToolEvent = {
        id,
        runId: run.id,
        type: "tool",
        ...splitToolName(turn.toolName),
        toolCallId: turn.toolCallId,
        status: terminal ? "unknown" : "running",
        startedAt: turn.timestamp,
        input: turn.arguments,
        externalJobHandoff: false,
      };
      events.push(event);
      if (turn.toolCallId && !openCalls.has(turn.toolCallId)) openCalls.set(turn.toolCallId, event);
      return;
    }
    const open = turn.toolCallId ? openCalls.get(turn.toolCallId) : undefined;
    if (open && turn.toolCallId) {
      openCalls.delete(turn.toolCallId);
      open.endedAt = turn.timestamp;
      open.output = turn.result;
      open.observedDurationMs = durationMs(open.startedAt, open.endedAt);
      open.status = turn.success ? "completed" : "failed";
      if (!turn.success) open.error = errorText(turn.result);
      return;
    }
    // Unmatched result: kept alone, never attached by guess.
    events.push({
      id,
      runId: run.id,
      type: "tool",
      ...splitToolName(turn.toolName),
      toolCallId: turn.toolCallId,
      status: "unknown",
      endedAt: turn.timestamp,
      output: turn.result,
      externalJobHandoff: false,
    });
  });
  return events;
}

export function summarizeTrace(events: readonly TraceEvent[]): { toolCallCount: number; failedToolCallCount: number } {
  const toolEvents = events.filter((e): e is TraceToolEvent => e.type === "tool");
  return {
    toolCallCount: toolEvents.length,
    failedToolCallCount: toolEvents.filter((e) => e.status === "failed").length,
  };
}
