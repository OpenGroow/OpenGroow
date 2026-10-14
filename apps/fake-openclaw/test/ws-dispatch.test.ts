import { describe, it, expect } from "vitest";
import { buildCommandEvent } from "../src/ws-dispatch.js";
import type { Command } from "@opengroow/protocol";
import {
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_NODES_APPROVE_RESULT
} from "@opengroow/protocol";

const INSTANCE = "test-instance";

function cmd(type: string, payload?: unknown): Command {
  return { id: "cmd-1", type, payload, ts: Date.now() };
}

describe("buildCommandEvent — existing commands", () => {
  it("RUNTIME_NODES_PENDING_LIST returns pending list result", () => {
    const event = buildCommandEvent(cmd("runtime.nodes.pending.list"), INSTANCE);
    expect(event?.type).toBe(RUNTIME_NODES_PENDING_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
    expect(p.instanceId).toBe(INSTANCE);
  });

  it("RUNTIME_NODES_APPROVE returns ok when requestId is present", () => {
    const event = buildCommandEvent(cmd("runtime.nodes.approve", { requestId: "req-1" }), INSTANCE);
    expect(event?.type).toBe(RUNTIME_NODES_APPROVE_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
  });

  it("RUNTIME_NODES_APPROVE returns error when requestId is missing", () => {
    const event = buildCommandEvent(cmd("runtime.nodes.approve", {}), INSTANCE);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("requestId is required");
  });
});

describe("buildCommandEvent — RUNTIME_WORKSPACE_CREATE", () => {
  it("returns ok result with workspaceKey and label", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.create", { workspaceKey: "seo", label: "SEO Agent" }),
      INSTANCE
    );
    expect(event?.type).toBe(RUNTIME_WORKSPACE_CREATE_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
    expect((p.data as Record<string, unknown>).workspaceKey).toBe("seo");
  });

  it("returns error when workspaceKey is missing", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.create", { label: "SEO Agent" }),
      INSTANCE
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("workspaceKey is required");
  });

  it("returns error when label is missing", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.create", { workspaceKey: "seo" }),
      INSTANCE
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("label is required");
  });
});

describe("buildCommandEvent — RUNTIME_WORKSPACE_FILE_WRITE", () => {
  it("returns ok result", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.file.write", { workspaceKey: "seo", filePath: "NOTES.md", content: "# Notes" }),
      INSTANCE
    );
    expect(event?.type).toBe(RUNTIME_WORKSPACE_FILE_WRITE_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
  });

  it("returns error when workspaceKey is missing", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.file.write", { filePath: "NOTES.md", content: "# Notes" }),
      INSTANCE
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("workspaceKey is required");
  });

  it("returns error when filePath is missing", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.file.write", { workspaceKey: "seo", content: "# Tools" }),
      INSTANCE
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("filePath is required");
  });

  it("returns error when content is missing", () => {
    const event = buildCommandEvent(
      cmd("runtime.workspace.file.write", { workspaceKey: "seo", filePath: "NOTES.md" }),
      INSTANCE
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("content is required");
  });
});

describe("buildCommandEvent — RUNTIME_MCP_SERVERS_MERGE", () => {
  it("returns ok with merged keys", () => {
    const event = buildCommandEvent(
      cmd("runtime.mcp.servers.merge", { servers: { "article-mcp": { url: "https://example.com" } } }),
      INSTANCE
    );
    expect(event?.type).toBe(RUNTIME_MCP_SERVERS_MERGE_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
    expect((p.data as Record<string, unknown>).mergedKeys).toEqual(["article-mcp"]);
  });

  it("returns error when servers is missing", () => {
    const event = buildCommandEvent(cmd("runtime.mcp.servers.merge", {}), INSTANCE);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("servers is required");
  });

  it("returns error when servers is an array", () => {
    const event = buildCommandEvent(cmd("runtime.mcp.servers.merge", { servers: [] }), INSTANCE);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
  });
});

describe("buildCommandEvent — RUNTIME_MCP_SERVERS_REMOVE", () => {
  it("returns ok with removed keys", () => {
    const event = buildCommandEvent(
      cmd("runtime.mcp.servers.remove", { keys: ["article-mcp"] }),
      INSTANCE
    );
    expect(event?.type).toBe(RUNTIME_MCP_SERVERS_REMOVE_RESULT);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(true);
    expect((p.data as Record<string, unknown>).removedKeys).toEqual(["article-mcp"]);
  });

  it("returns error when keys is missing", () => {
    const event = buildCommandEvent(cmd("runtime.mcp.servers.remove", {}), INSTANCE);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.error).toBe("keys is required");
  });

  it("returns error when keys is not an array", () => {
    const event = buildCommandEvent(cmd("runtime.mcp.servers.remove", { keys: "article-mcp" }), INSTANCE);
    const p = event?.payload as Record<string, unknown>;
    expect(p.ok).toBe(false);
  });
});

describe("buildCommandEvent — unknown command", () => {
  it("returns null for unknown command type", () => {
    expect(buildCommandEvent(cmd("unknown.command"), INSTANCE)).toBeNull();
  });

  it("returns null when command.id is empty", () => {
    expect(buildCommandEvent({ id: "", type: "runtime.workspace.create", ts: Date.now() }, INSTANCE)).toBeNull();
  });
});
