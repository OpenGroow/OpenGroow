import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Loaded via `require("node:sqlite")` rather than a static `import` —
// older Vite/vitest builds don't recognize `node:sqlite` as a Node builtin
// and try to bundle it, which fails since it's not an npm package.
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const { readSessionTranscript } = require("../docker/control-socket-sessions.js") as {
  readSessionTranscript: (
    input: { agentName: string; sessionKey: string },
    options: { homeDir: string },
  ) => Promise<{
    agentName: string;
    found: boolean;
    turns: Array<Record<string, unknown>>;
  }>;
};

const tempDirs: string[] = [];

async function makeHomeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "opengroow-sessions-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Builds `agents/<agentName>/agent/openclaw-agent.sqlite` with a
 * `transcript_events` table shaped like OpenClaw's real per-agent store
 * (see `docker/control-socket-sessions.js`'s doc comment), and inserts one
 * row per `events` entry for `sessionId`.
 */
async function makeAgentDb(
  homeDir: string,
  agentName: string,
  sessionId: string,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  const agentDir = path.join(homeDir, ".openclaw", "agents", agentName, "agent");
  await mkdir(agentDir, { recursive: true });
  const db = new DatabaseSync(path.join(agentDir, "openclaw-agent.sqlite"));
  db.exec(
    "create table if not exists transcript_events (session_id text not null, seq integer not null, event_json text not null, created_at integer not null, primary key (session_id, seq))",
  );
  const insert = db.prepare(
    "insert into transcript_events (session_id, seq, event_json, created_at) values (?, ?, ?, ?)",
  );
  events.forEach((event, index) => {
    insert.run(sessionId, index + 1, JSON.stringify(event), Date.now());
  });
  db.close();
}

describe("readSessionTranscript", () => {
  it("returns found: false when the agent has no database yet", async () => {
    const homeDir = await makeHomeDir();

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-abc123" },
      { homeDir },
    );

    expect(result).toEqual({ agentName: "seo-agent", found: false, turns: [] });
  });

  it("returns found: false when that Run's session doesn't exist, even if others do", async () => {
    const homeDir = await makeHomeDir();
    await makeAgentDb(homeDir, "seo-agent", "mega-run-other", [
      { type: "message", message: { role: "user", content: "a different run" } },
    ]);

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-missing" },
      { homeDir },
    );

    expect(result).toEqual({ agentName: "seo-agent", found: false, turns: [] });
  });

  it("reads and parses the transcript for the exact Run's sessionKey, including tool calls and results", async () => {
    const homeDir = await makeHomeDir();
    await makeAgentDb(homeDir, "seo-agent", "mega-run-other", [
      {
        type: "message",
        message: { role: "user", content: "a different run, must not be returned" },
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await makeAgentDb(homeDir, "seo-agent", "mega-run-target", [
      { type: "session", version: 3, id: "mega-run-target" },
      {
        type: "message",
        message: { role: "user", content: "Write the weekly SEO report" },
        timestamp: "2026-07-02T10:00:00.000Z",
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_1",
              name: "carousel-mcp.create_carousel",
              arguments: { carouselFormat: "contrast", contentPattern: "do_dont" },
            },
          ],
        },
        timestamp: "2026-07-02T10:00:05.000Z",
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "carousel-mcp.create_carousel",
          isError: false,
          content: [{ type: "toolResult", text: "ok", content: { id: "carousel-1" } }],
        },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Here is the report." }] },
        timestamp: "2026-07-02T10:00:15.000Z",
      },
      { type: "summary", message: { role: "system", content: "ignored" } },
    ]);

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-target" },
      { homeDir },
    );

    expect(result.agentName).toBe("seo-agent");
    expect(result.found).toBe(true);
    expect(result.turns).toEqual([
      {
        kind: "message",
        role: "user",
        text: "Write the weekly SEO report",
        timestamp: "2026-07-02T10:00:00.000Z",
      },
      {
        kind: "tool_call",
        toolName: "carousel-mcp.create_carousel",
        arguments: { carouselFormat: "contrast", contentPattern: "do_dont" },
        timestamp: "2026-07-02T10:00:05.000Z",
      },
      {
        kind: "tool_result",
        toolName: "carousel-mcp.create_carousel",
        success: true,
        result: "ok",
        timestamp: "2026-07-02T10:00:10.000Z",
      },
      {
        kind: "message",
        role: "assistant",
        text: "Here is the report.",
        timestamp: "2026-07-02T10:00:15.000Z",
      },
    ]);
  });

  it("marks a tool result as unsuccessful when isError is true", async () => {
    const homeDir = await makeHomeDir();
    await makeAgentDb(homeDir, "seo-agent", "mega-run-target", [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "bash",
          isError: true,
          content: [{ type: "toolResult", text: "command failed" }],
        },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-target" },
      { homeDir },
    );

    expect(result.turns).toEqual([
      {
        kind: "tool_result",
        toolName: "bash",
        success: false,
        result: "command failed",
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);
  });

  it("deep-parses a tool result whose text is itself a JSON-encoded document", async () => {
    const homeDir = await makeHomeDir();
    await makeAgentDb(homeDir, "seo-agent", "mega-run-target", [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "carousel-mcp.create_carousel",
          isError: false,
          content: [{ type: "toolResult", text: '{"id":"carousel-1","slides":[{"doText":"1"}]}' }],
        },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-target" },
      { homeDir },
    );

    expect(result.turns).toEqual([
      {
        kind: "tool_result",
        toolName: "carousel-mcp.create_carousel",
        success: true,
        result: { id: "carousel-1", slides: [{ doText: "1" }] },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);
  });

  it("keeps the full content block when it has no plain-string text/content field", async () => {
    const homeDir = await makeHomeDir();
    await makeAgentDb(homeDir, "seo-agent", "mega-run-target", [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "carousel-mcp.status_check",
          isError: false,
          content: [{ type: "toolResult", structured: { status: "ready" } }],
        },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);

    const result = await readSessionTranscript(
      { agentName: "seo-agent", sessionKey: "mega-run-target" },
      { homeDir },
    );

    expect(result.turns).toEqual([
      {
        kind: "tool_result",
        toolName: "carousel-mcp.status_check",
        success: true,
        result: { type: "toolResult", structured: { status: "ready" } },
        timestamp: "2026-07-02T10:00:10.000Z",
      },
    ]);
  });

  it("rejects an agentName that looks like a path traversal attempt", async () => {
    const homeDir = await makeHomeDir();

    await expect(
      readSessionTranscript(
        { agentName: "../../etc", sessionKey: "mega-run-target" },
        { homeDir },
      ),
    ).rejects.toThrow(/agentName/);
  });

  it("rejects a sessionKey that looks like a path traversal attempt", async () => {
    const homeDir = await makeHomeDir();

    await expect(
      readSessionTranscript(
        { agentName: "seo-agent", sessionKey: "../../etc/passwd" },
        { homeDir },
      ),
    ).rejects.toThrow(/sessionKey/);
  });
});
