# PRD — Agent Execution Trace

Terms (Trace, Trace Event, Tool Call, Observed duration, External Job handoff) are defined in `docs/domain/missions.md`.

## 1. Context

The raw OpenClaw execution logs of a Run (messages, tool calls, tool results) are shown chronologically and unstructured, which makes it hard to see what an Agent did, inspect a tool call or spot a problem. The Trace is a structured, read-only view of a Run. The raw logs stay available and unchanged.

## 2. Objectives

Understand what an Agent did in a Run; see the sequence of Tool Calls; spot slow, failed or repeated ones; inspect their arguments and responses; help debug the Agent's instructions.

## 3. V1 constraints

No new table, no new infrastructure, no graph, no change to the Agent execution lifecycle, MCP contracts or Mission dispatching. The Trace is derived from the existing session transcript, on demand.

One additive change to the transcript read contract is accepted: expose the native `toolCallId` (optional) on `tool_call` and `tool_result` turns (`control-socket-sessions.js`, the zod schema in `workspace_logs_node.ts`, `packages/protocol`). OpenClaw already records it; the control socket drops it today. Without it, grouping would have to guess from the tool name, which the product principles forbid. This requires rebuilding the runtime image.

## 4. Navigation

- A **Trace** entry in the sidebar.
- A **View trace** link from existing Runs (next to the raw logs).
- Raw logs are kept.

## 5. User interface

### 5.1 Run list

Recent Runs, newest first, of Missions and Jobs across Projects. Each row: Mission or Job name, Agent, Project, date, Run duration (`createdAt` to `completedAt`), Run status. Filters: Project (default: all), Agent, Status. The tool call count is not in the list (it would cost one transcript read per row); it is in the summary of the opened Trace. Runs with no session yet (`pending`, `dispatching`) are listed with an empty state, not an error.

### 5.2 Timeline

Waterfall of Trace Events in transcript order: Instruction, Agent message, Tool Call, External Job handoff (when identified). A call and its result are one element. A Tool Call shows tool name, MCP server when there is one, start, Observed duration when both timestamps exist, status. Instructions and messages are visually distinct from Tool Calls. Only events present in the transcript are shown; nothing is reconstructed. Overlap is drawn only when timestamps support it.

In the timeline, payloads are shown as a truncated preview only, so large payloads do not weigh on the DOM.

### 5.3 Inspector

Right-side panel opened on a Tool Call, with three tabs: **Input** (full arguments), **Output** (full result), **Metadata** (tool call id when available, tool name, server, start/end, Observed duration, status, error). JSON or text formatted, copy button, scrollable, never widens the timeline. Full content is loaded in the inspector only.

### 5.4 Summary

Above the timeline: Run status, **Run duration** (elapsed), Tool Call count, failed Tool Call count. Run duration and Observed durations are always distinguished. When the Run is `awaiting_job`, a footer states that it is waiting for the External Job (from the Run status, not from a Tool Call's output).

### 5.5 Live

While the Trace page is open and the Run is not terminal: poll the transcript about every 3 s, one request at a time (no concurrent requests; the next poll starts after the previous one ends). Polling runs only while the Trace is being viewed and stops when it is left. When the Run becomes terminal, one last read is made, then polling stops. A failed poll keeps the last valid Trace with a notice that updating is interrupted.

## 6. Statuses

Tool Call: `running`, `completed`, `failed`, `unknown`.

- A result flagged as an error is `failed`.
- A call with no result on a terminal Run is `unknown`, never `failed`. On a non-terminal Run it is `running`.
- An unmatched result is kept as its own element, `unknown`.
- External Job handoff: only a Tool Call matching the Run's `mcpJob` (same server and tool name, output carrying the job id) is labeled "External Job started". Any other reply containing `status: started` is a plain Tool Call. The Tool Call stays `completed` while the External Job may still be running; the Run status says which.

## 7. Technical approach

- Transport and validation stay in Convex (the existing `getWorkspaceRunTranscript` and the list queries). No new table.
- Normalization is a **pure TypeScript function in the dashboard**, independent of React components and covered by unit tests: transcript turns (+ Run status and `mcpJob`) in, ordered Trace Events out.
- The Run list needs a Convex query across Projects (existing `runs` indexes); the Run's `mcpJob` must be exposed to the dashboard in client-safe form (never `sessionKey`).
- Normalized shape (indicative): `id`, `runId`, `type` (`instruction` | `agent` | `tool`), `name`, `server`, `toolCallId`, `startedAt`, `endedAt`, `status`, `input`, `output`, `error`, plus a flag for the External Job handoff.
- Prefixed tool names (`server.tool`) are split into server and tool.
- Security: reuse the existing Workspace and Run authorization (as the raw logs do). Check that transcripts do not expose secrets before showing them, and never expose `sessionKey`.

## 8. Acceptance criteria

- A Trace entry is in the sidebar and a View trace link on existing Runs; raw logs remain.
- Runs can be browsed and filtered by Project, Agent, Status.
- Events are in transcript order; calls and results are grouped only through `toolCallId`.
- Inputs and outputs are available in the inspector; the timeline shows truncated previews only.
- Failed Tool Calls are visually identifiable; missing results are `unknown` on a terminal Run.
- Run duration and Observed durations are displayed apart; missing timestamps give empty values, never invented ones.
- "External Job started" appears only for a Tool Call matching the Run's `mcpJob`.
- An active Run updates by polling, with no concurrent requests, and a final read at the terminal state.
- Historical Runs are supported wherever their transcript remains.
- Normalization has unit tests, including: parallel calls, missing `toolCallId`, orphan call, orphan result, error result, `status: started` that is not a handoff.

## 9. Out of scope

Execution or dependency graphs, distributed tracing, OpenTelemetry, token/cost tracking, LLM reasoning, replay, retrying calls, automated debugging, changes to OpenClaw orchestration, persisted tool call counters (revisit if the list needs them).

## 10. Principles

Read-only observability; reuse existing data; readability first; progressive disclosure; no unnecessary infrastructure; never infer a relationship the transcript does not establish.
