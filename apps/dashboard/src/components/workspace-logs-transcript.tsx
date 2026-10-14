import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LogsStatePanel } from "@/src/components/workspace-logs-state-panel";
import type { SessionTranscriptTurn, TranscriptState } from "@/src/components/workspace-logs.types";

/** The selected Run's session transcript — what the Agent said and did. */
export function TranscriptPanel({ transcript }: { transcript: TranscriptState }) {
  if (transcript.status === "loading") {
    return <LogsStatePanel title="Loading logs" description="Reading the selected Run's transcript." />;
  }
  if (transcript.status === "error") {
    return <LogsStatePanel title="Could not load logs" description={transcript.error} tone="error" />;
  }
  if (!transcript.found) {
    return (
      <LogsStatePanel
        title="No runs yet"
        description="This Agent hasn't run yet — logs will appear here after its first run."
      />
    );
  }
  return <TranscriptList turns={transcript.turns} />;
}

function TranscriptList({ turns }: { turns: SessionTranscriptTurn[] }) {
  if (turns.length === 0) {
    return (
      <LogsStatePanel
        title="No activity recorded"
        description="This run did not produce any recorded turns."
      />
    );
  }

  return (
    <div className="grid gap-3 self-start">
      {turns.map((turn, index) => (
        <TranscriptTurnCard key={index} turn={turn} />
      ))}
    </div>
  );
}

function TranscriptTurnCard({ turn }: { turn: SessionTranscriptTurn }) {
  if (turn.kind === "tool_call" || turn.kind === "tool_result") {
    return <ToolEventCard turn={turn} />;
  }

  return (
    <Card
      className={cn(
        "rounded-[1.4rem] border-0 py-4 shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]",
        turn.role === "assistant" ? "bg-[#fbfcfa]" : "bg-[rgba(220,230,224,0.35)]",
      )}
    >
      <CardContent className="grid gap-1.5 px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
            {turn.role === "assistant" ? "Agent" : "Instruction"}
          </span>
          {turn.timestamp ? (
            <span className="text-[0.78rem] text-[var(--dashboard-ink-muted)]">
              {new Date(turn.timestamp).toLocaleString()}
            </span>
          ) : null}
        </div>
        <p className="m-0 whitespace-pre-wrap text-[0.96rem] leading-7 text-[var(--dashboard-ink)]">
          {turn.text}
        </p>
      </CardContent>
    </Card>
  );
}

// Renders a tool payload for the debug view. The control-socket already
// deep-parses any JSON-encoded string fields before this reaches the
// dashboard (apps/openclaw-docker-config/docker/control-socket-sessions.js
// `deepParseJsonStrings`), so a plain string here is already prose, real
// newlines and all — shown as-is rather than re-wrapped in `JSON.stringify`,
// which would only re-escape it back into unreadable `\n`/`\"` literals.
// Only actual structure (object/array) goes through `JSON.stringify` for
// indentation.
function formatPayloadForDisplay(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

// A tool call/result pair — what was actually sent to/received from a tool
// (e.g. an MCP server like carousel-mcp) — shown distinctly from
// conversational turns since debugging Mission output usually means reading
// this, not what the agent said in between. Collapsed by default: payloads
// (image prompts, slide lists, ...) can be long.
function ToolEventCard({
  turn,
}: {
  turn: Extract<SessionTranscriptTurn, { kind: "tool_call" | "tool_result" }>;
}) {
  const isResult = turn.kind === "tool_result";
  const payload = isResult ? turn.result : turn.arguments;
  return (
    <Card className="rounded-[1.4rem] border-0 bg-[#fbf9f2] py-4 shadow-[inset_0_0_0_1px_rgba(180,140,40,0.18)]">
      <CardContent className="grid gap-1.5 px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#8a6a1a]">
            {isResult ? "Tool result" : "Tool call"} · {turn.toolName}
            {isResult && !turn.success ? " · error" : ""}
          </span>
          {turn.timestamp ? (
            <span className="text-[0.78rem] text-[var(--dashboard-ink-muted)]">
              {new Date(turn.timestamp).toLocaleString()}
            </span>
          ) : null}
        </div>
        <details>
          <summary className="cursor-pointer text-[0.82rem] font-semibold text-[var(--dashboard-ink-soft)]">
            {isResult ? "View response" : "View arguments"}
          </summary>
          <pre className="m-0 mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-[0.78rem] leading-relaxed text-[var(--dashboard-ink)]">
            {formatPayloadForDisplay(payload)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
