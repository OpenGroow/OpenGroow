import { describe, it, expect } from "vitest";
import * as protocol from "./index.js";
import {
  InvalidWireMessageError,
  parseRuntimeResult,
  parseValidatedMessage,
  encode,
} from "./index.js";

describe("workspace/MCP protocol constants", () => {
  it("exports RUNTIME_WORKSPACE_CREATE command and result constants", () => {
    expect(protocol.RUNTIME_WORKSPACE_CREATE).toBe("runtime.workspace.create");
    expect(protocol.RUNTIME_WORKSPACE_CREATE_RESULT).toBe("runtime.workspace.create.result");
  });

  it("exports RUNTIME_WORKSPACE_FILE_WRITE command and result constants", () => {
    expect(protocol.RUNTIME_WORKSPACE_FILE_WRITE).toBe("runtime.workspace.file.write");
    expect(protocol.RUNTIME_WORKSPACE_FILE_WRITE_RESULT).toBe("runtime.workspace.file.write.result");
  });

  it("exports RUNTIME_MCP_SERVERS_MERGE command and result constants", () => {
    expect(protocol.RUNTIME_MCP_SERVERS_MERGE).toBe("runtime.mcp.servers.merge");
    expect(protocol.RUNTIME_MCP_SERVERS_MERGE_RESULT).toBe("runtime.mcp.servers.merge.result");
  });

  it("exports RUNTIME_MCP_SERVERS_REMOVE command and result constants", () => {
    expect(protocol.RUNTIME_MCP_SERVERS_REMOVE).toBe("runtime.mcp.servers.remove");
    expect(protocol.RUNTIME_MCP_SERVERS_REMOVE_RESULT).toBe("runtime.mcp.servers.remove.result");
  });

  it("exports RUNTIME_PLUGINS_INSTALL command and result constants", () => {
    expect(protocol.RUNTIME_PLUGINS_INSTALL).toBe("runtime.plugins.install");
    expect(protocol.RUNTIME_PLUGINS_INSTALL_RESULT).toBe("runtime.plugins.install.result");
  });

  it("exports RUNTIME_WORKSPACE_SKILL_FILES command and result constants", () => {
    expect(protocol.RUNTIME_WORKSPACE_SKILL_FILES).toBe("runtime.workspace.skill_files");
    expect(protocol.RUNTIME_WORKSPACE_SKILL_FILES_RESULT).toBe(
      "runtime.workspace.skill_files.result",
    );
  });
});

describe("workspace/MCP payload types", () => {
  it("RuntimeWorkspaceCreateCommandPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceCreateCommandPayload = {
      workspaceKey: "seo-agent",
      label: "SEO Agent"
    };
    expect(payload.workspaceKey).toBe("seo-agent");
    expect(payload.label).toBe("SEO Agent");
  });

  it("RuntimeWorkspaceCreateResultPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceCreateResultPayload = {
      commandId: "cmd-1",
      instanceId: "inst-1",
      ok: true,
      data: { workspaceKey: "seo-agent", label: "SEO Agent" }
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.workspaceKey).toBe("seo-agent");
  });

  it("RuntimeWorkspaceFileWriteCommandPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceFileWriteCommandPayload = {
      workspaceKey: "seo-agent",
      filePath: "NOTES.md",
      content: "# SEO Tools"
    };
    expect(payload.workspaceKey).toBe("seo-agent");
    expect(payload.filePath).toBe("NOTES.md");
    expect(payload.content).toBe("# SEO Tools");
  });

  it("RuntimeWorkspaceFileWriteResultPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceFileWriteResultPayload = {
      commandId: "cmd-2",
      instanceId: "inst-1",
      ok: true,
      data: { workspaceKey: "seo-agent", filePath: "NOTES.md" }
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.filePath).toBe("NOTES.md");
  });

  it("RuntimeWorkspaceSkillFilesCommandPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceSkillFilesCommandPayload = {
      workspaceKey: "seo-agent",
      spec: "cubic/avoid-ai-writing",
    };
    expect(payload.workspaceKey).toBe("seo-agent");
    expect(payload.spec).toBe("cubic/avoid-ai-writing");
  });

  it("RuntimeWorkspaceSkillFilesResultPayload has correct shape", () => {
    const payload: protocol.RuntimeWorkspaceSkillFilesResultPayload = {
      commandId: "cmd-3",
      instanceId: "inst-1",
      ok: true,
      data: {
        workspaceKey: "seo-agent",
        spec: "cubic/avoid-ai-writing",
        files: [{ filePath: "skills/cubic/avoid-ai-writing/SKILL.md", title: "skill", kind: "skill" }],
      },
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.files[0]?.kind).toBe("skill");
  });

  it("RuntimeMcpServersMergeCommandPayload has correct shape", () => {
    const payload: protocol.RuntimeMcpServersMergeCommandPayload = {
      servers: {
        "article-mcp": { url: "https://seo.example.com/mcp" }
      }
    };
    expect(payload.servers["article-mcp"]).toBeDefined();
  });

  it("RuntimeMcpServersMergeResultPayload has correct shape", () => {
    const payload: protocol.RuntimeMcpServersMergeResultPayload = {
      commandId: "cmd-3",
      instanceId: "inst-1",
      ok: true,
      data: { mergedKeys: ["article-mcp"] }
    };
    expect(payload.data.mergedKeys).toEqual(["article-mcp"]);
  });

  it("RuntimeMcpServersRemoveCommandPayload has correct shape", () => {
    const payload: protocol.RuntimeMcpServersRemoveCommandPayload = {
      keys: ["article-mcp"]
    };
    expect(payload.keys).toEqual(["article-mcp"]);
  });

  it("RuntimeMcpServersRemoveResultPayload has correct shape", () => {
    const payload: protocol.RuntimeMcpServersRemoveResultPayload = {
      commandId: "cmd-4",
      instanceId: "inst-1",
      ok: true,
      data: { removedKeys: ["article-mcp"] }
    };
    expect(payload.data.removedKeys).toEqual(["article-mcp"]);
  });
});

describe("validated message decoder", () => {
  it("narrows a hello message", () => {
    const msg = parseValidatedMessage({ type: "hello", protocolVersion: 1 });
    expect(msg.type).toBe("hello");
    if (msg.type === "hello") {
      expect(msg.protocolVersion).toBe(1);
    }
  });

  it("narrows a hello_ok message", () => {
    const msg = parseValidatedMessage({ type: "hello_ok", instanceId: "inst-1", heartbeatIntervalMs: 5000, protocolVersion: 1 });
    expect(msg.type).toBe("hello_ok");
  });

  it("narrows a ping message", () => {
    const msg = parseValidatedMessage({ type: "ping", ts: 123 });
    expect(msg.type).toBe("ping");
  });

  it("narrows a command message", () => {
    const msg = parseValidatedMessage({ type: "command", command: { id: "c1", type: "runtime.health.check", ts: 1 } });
    expect(msg.type).toBe("command");
  });

  it("narrows a relay_data message", () => {
    const msg = parseValidatedMessage({ type: "relay_data", sessionId: "s1", encoding: "utf8", data: "hi" });
    expect(msg.type).toBe("relay_data");
    if (msg.type === "relay_data") {
      expect(msg.encoding).toBe("utf8");
    }
  });

  it("narrows a relay_attach message", () => {
    const msg = parseValidatedMessage({ type: "relay_attach", sessionId: "s1", instanceId: "i1", path: "/ws" });
    expect(msg.type).toBe("relay_attach");
  });

  it("narrows a relay_attached message", () => {
    const msg = parseValidatedMessage({ type: "relay_attached", sessionId: "s1", instanceId: "i1" });
    expect(msg.type).toBe("relay_attached");
  });

  it("rejects an unknown type with a safe field path", () => {
    expect(() => parseValidatedMessage({ type: "totally_unknown" })).toThrow(
      "Invalid ws message totally_unknown at $.type",
    );
  });

  it("rejects a missing type", () => {
    expect(() => parseValidatedMessage({ foo: "bar" })).toThrow(
      "Invalid ws message at $.type",
    );
  });

  it("rejects null", () => {
    expect(() => parseValidatedMessage(null)).toThrow(
      "Invalid ws message at $",
    );
  });

  it("rejects a primitive value", () => {
    expect(() => parseValidatedMessage("hello")).toThrow(
      "Invalid ws message at $",
    );
  });
});

describe("encode()", () => {
  it("serialises a Message to JSON", () => {
    const msg: protocol.Message = { type: "ping", ts: 42 };
    expect(encode(msg)).toBe(JSON.stringify({ type: "ping", ts: 42 }));
  });
});

describe("validated wire codecs", () => {
  it("validates nested command envelopes instead of only the discriminant", () => {
    expect(
      parseValidatedMessage({
        type: "command",
        command: {
          id: "cmd-1",
          type: protocol.RUNTIME_WORKSPACE_FILE_READ,
          ts: 1,
          payload: { workspaceKey: "ws", filePath: "AGENTS.md" },
        },
      }),
    ).toMatchObject({ type: "command" });

    expect(() =>
      parseValidatedMessage({
        type: "command",
        command: { id: "cmd-1", type: protocol.RUNTIME_WORKSPACE_FILE_READ, ts: 1, payload: "bad" },
      }),
    ).toThrow(InvalidWireMessageError);
  });

  it("rejects an unknown message type through the strict codec", () => {
    expect(() => parseValidatedMessage({ type: "not_a_real_type" })).toThrow(
      InvalidWireMessageError,
    );
  });

  it("rejects a non-record value through the strict codec", () => {
    expect(() => parseValidatedMessage("just a string")).toThrow(InvalidWireMessageError);
    expect(() => parseValidatedMessage(null)).toThrow(InvalidWireMessageError);
    expect(() => parseValidatedMessage(42)).toThrow(InvalidWireMessageError);
  });

  it("rejects a discriminated union whose fields don't match its own type tag", () => {
    // `type: "relay_data"` but shaped like a `relay_attach` envelope —
    // structurally inconsistent even though the discriminant is known.
    expect(() =>
      parseValidatedMessage({
        type: "relay_data",
        sessionId: "session-1",
        headers: {},
      }),
    ).toThrow(InvalidWireMessageError);
  });

  it("validates runtime result envelopes and keeps error paths safe", () => {
    expect(
      parseRuntimeResult(protocol.RUNTIME_WORKSPACE_FILE_READ_RESULT, {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: {
          workspaceKey: "ws",
          filePath: "AGENTS.md",
          title: "AGENTS",
          content: "secret content",
        },
      }),
    ).toMatchObject({ commandId: "cmd-1", instanceId: "instance-1", ok: true });

    try {
      parseRuntimeResult(protocol.RUNTIME_WORKSPACE_FILE_READ_RESULT, {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: "bad",
        token: "do-not-leak",
      });
      throw new Error("expected invalid payload");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWireMessageError);
      expect((error as Error).message).not.toContain("do-not-leak");
      expect((error as InvalidWireMessageError).issue.path).toBe("$.payload.data");
    }

    try {
      parseRuntimeResult(protocol.RUNTIME_WORKSPACE_FILE_READ_RESULT, {
        commandId: "cmd-1",
        instanceId: "instance-1",
        ok: true,
        data: "bad",
        apiKey: "sk-do-not-leak",
      });
      throw new Error("expected invalid payload");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWireMessageError);
      expect((error as Error).message).not.toContain("sk-do-not-leak");
      expect(JSON.stringify((error as InvalidWireMessageError).issue)).not.toContain("sk-do-not-leak");
    }
  });

  it("reports the family and field path for invalid relay messages", () => {
    expect(() =>
      parseValidatedMessage(
        { type: "relay_data", sessionId: "session-1", encoding: "utf8" },
        "admin_relay",
      ),
    ).toThrow("Invalid admin_relay message relay_data at $.data");
  });
});

describe("existing exports are not broken", () => {
  it("still exports existing workspace constants", () => {
    expect(protocol.RUNTIME_WORKSPACE_LIST).toBe("runtime.workspace.list");
    expect(protocol.RUNTIME_WORKSPACE_LIST_RESULT).toBe("runtime.workspace.list.result");
    expect(protocol.RUNTIME_WORKSPACE_FILE_READ).toBe("runtime.workspace.file.read");
    expect(protocol.RUNTIME_WORKSPACE_FILE_READ_RESULT).toBe("runtime.workspace.file.read.result");
  });

  it("still exports buildRuntimeResultEventId", () => {
    expect(protocol.buildRuntimeResultEventId("abc")).toBe("runtime-result:abc");
  });
});
