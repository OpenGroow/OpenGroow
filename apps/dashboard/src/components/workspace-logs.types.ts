import type { Id } from "@convex/_generated/dataModel";

// Mirrors `transcriptTurnZ` in apps/convex/workspace_logs_node.ts: a
// conversational message, or what was actually sent to/received from a tool
// (e.g. an MCP server like carousel-mcp) during the Run.
export type SessionTranscriptTurn =
  | { kind: "message"; role: "user" | "assistant"; text: string; timestamp?: string }
  | { kind: "tool_call"; toolName: string; arguments?: unknown; timestamp?: string }
  | { kind: "tool_result"; toolName: string; success: boolean; result?: unknown; timestamp?: string };

export type TranscriptState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "data"; found: boolean; turns: SessionTranscriptTurn[]; runId: Id<"runs"> | null };

/** The Agent's generic Job as the Agent Logs "Jobs" section needs it — the client-side shape of
 * `workspace_logs.listJobsForWorkspace`.
 */
export type JobSummary = {
  _id: Id<"jobs">;
  jobType: string;
  agentName: string;
  lastOutcome?: string;
  lastRunAt?: number;
  lastError?: string;
};
