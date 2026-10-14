"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { getHomeDir } = require("./control-socket-workspaces");

const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
// Runs are dispatched with a `sessionKey` of the form `mega-run-<convexId>`
// (see apps/convex/missions.ts `dispatchRun`), passed to OpenClaw as
// `--session-id`. Same safe character set as agentName, just a longer cap to
// comfortably fit the Convex id suffix.
const SESSION_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;

function assertAgentName(agentName) {
  const trimmed = typeof agentName === "string" ? agentName.trim() : "";
  if (!AGENT_NAME_RE.test(trimmed)) {
    throw new Error(
      "agentName must be 1-128 chars of letters, numbers, dot, underscore, or dash",
    );
  }
  return trimmed;
}

function assertSessionKey(sessionKey) {
  const trimmed = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!SESSION_KEY_RE.test(trimmed)) {
    throw new Error(
      "sessionKey must be 1-256 chars of letters, numbers, dot, underscore, or dash",
    );
  }
  return trimmed;
}

/**
 * Some tool payloads embed a whole JSON document inside a single string
 * field (an MCP content block returning its result as JSON-encoded text,
 * for instance — `carousel-mcp.create_carousel`'s response does this).
 * Recursively parsing those here, once, at the point the payload is shaped
 * for the dashboard, means every consumer of `readSessionTranscript` sees
 * real nested structure instead of an escaped JSON-in-a-string blob and
 * having to redo this unwrap itself.
 */
function deepParseJsonStrings(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const looksLikeJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (!looksLikeJson) {
      return value;
    }
    try {
      return deepParseJsonStrings(JSON.parse(trimmed));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(deepParseJsonStrings);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, deepParseJsonStrings(v)]),
    );
  }
  return value;
}

/**
 * Turns a `toolResult` message's `content` blocks into something JSON-safe
 * to hand back to the dashboard. The single-block case OpenClaw actually
 * produces duplicates the same string under several legacy-compatibility
 * keys at once (`text`/`content`, and `id`/`toolCallId`/`toolUseId`/
 * `tool_use_id` all holding the same call id) — a debug view only needs
 * the one human-readable string, not that redundancy, so this unwraps to
 * `block.text` (falling back to `block.content`) when it's a plain string.
 * Anything else — no single-string field, multiple blocks, non-array
 * content — is kept as-is rather than guessing further.
 */
function extractToolResultPayload(content) {
  if (!Array.isArray(content)) {
    return content ?? null;
  }
  if (content.length === 1 && content[0] && typeof content[0] === "object") {
    const block = content[0];
    if (typeof block.text === "string") {
      return block.text;
    }
    if (typeof block.content === "string") {
      return block.content;
    }
    return block;
  }
  return content;
}

/**
 * Parses one `transcript_events` row (`event_json`) into zero or more
 * readable "turns". OpenClaw session transcripts moved from flat `.jsonl`
 * files to a per-agent SQLite store (`agent/openclaw-agent.sqlite`, table
 * `transcript_events`) — this parses that new row shape, one JSON object
 * per row: `{ type: "message", message: { role, content, ... } }` for
 * conversation turns and tool activity alike:
 *   - `role: "user"` / `"assistant"` — `content` is a string, or an array of
 *     blocks (`{type:"text", text}`, `{type:"toolCall", id, name,
 *     arguments}`).
 *   - `role: "toolResult"` — a standalone message (not a content block
 *     nested in the assistant turn) carrying `toolName`, `toolCallId`,
 *     `isError`, and a `content` array with the tool's output.
 * Non-message rows (`type: "session"`, summaries, ...) and unparseable
 * lines are skipped rather than surfaced, so one bad row doesn't take down
 * the whole transcript render.
 */
function parseTranscriptEventRow(eventJson) {
  let entry;
  try {
    entry = JSON.parse(eventJson);
  } catch {
    return [];
  }
  if (!entry || typeof entry !== "object" || entry.type !== "message") {
    return [];
  }
  const message = entry.message;
  if (!message || typeof message !== "object") {
    return [];
  }
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
  const role = message.role;

  if (role === "user" || role === "assistant") {
    if (typeof message.content === "string") {
      const text = message.content.trim();
      return text ? [{ kind: "message", role, text, timestamp }] : [];
    }
    if (!Array.isArray(message.content)) {
      return [];
    }
    // Single pass: a text block contributes to the turn's prose (joined
    // below), a toolCall block becomes its own turn — no need to walk
    // `message.content` twice to collect each.
    const textParts = [];
    const turns = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "toolCall" && typeof block.name === "string") {
        turns.push({
          kind: "tool_call",
          toolName: block.name,
          arguments: deepParseJsonStrings(block.arguments ?? block.input ?? null),
          timestamp,
        });
      }
    }
    const text = textParts.join("\n").trim();
    return text ? [{ kind: "message", role, text, timestamp }, ...turns] : turns;
  }

  if (role === "toolResult" && typeof message.toolName === "string") {
    return [
      {
        kind: "tool_result",
        toolName: message.toolName,
        success: message.isError !== true,
        result: deepParseJsonStrings(extractToolResultPayload(message.content)),
        timestamp,
      },
    ];
  }

  return [];
}

/**
 * Reads a specific Run's session transcript for an Agent from
 * `~/.openclaw/agents/<agentName>/agent/openclaw-agent.sqlite` — the
 * per-agent SQLite store OpenClaw itself writes for the `openclaw agent
 * --session-id <sessionKey> ...` run that dispatched it (see ADR-025;
 * `sessionKey` is generated once per Run in apps/convex/missions.ts
 * `dispatchRun`, and doubles as the `session_id` row key in
 * `transcript_events`, and never changes for that Run). OpenClaw migrated
 * off the older flat `agents/<agentName>/sessions/<sessionKey>.jsonl` file
 * to this SQLite store; that legacy path is no longer written to, so this
 * must read from the database, not the filesystem. Returns `found: false`
 * (not an error) when that Run's session doesn't exist yet — e.g. the Run
 * hasn't started, or is still dispatching.
 */
async function readSessionTranscript({ agentName, sessionKey }, options = {}) {
  const trimmedAgentName = assertAgentName(agentName);
  const trimmedSessionKey = assertSessionKey(sessionKey);
  const homeDir = getHomeDir(options);
  const dbFile = path.join(
    homeDir,
    ".openclaw",
    "agents",
    trimmedAgentName,
    "agent",
    "openclaw-agent.sqlite",
  );

  let db;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
  } catch (error) {
    if (error && (error.code === "ENOENT" || /unable to open database file/i.test(error.message ?? ""))) {
      return { agentName: trimmedAgentName, found: false, turns: [] };
    }
    throw error;
  }

  try {
    const rows = db
      .prepare("select event_json from transcript_events where session_id = ? order by seq")
      .all(trimmedSessionKey);

    if (rows.length === 0) {
      return { agentName: trimmedAgentName, found: false, turns: [] };
    }

    const turns = rows.flatMap((row) => parseTranscriptEventRow(row.event_json));
    return { agentName: trimmedAgentName, found: true, turns };
  } finally {
    db.close();
  }
}

module.exports = {
  readSessionTranscript,
};
