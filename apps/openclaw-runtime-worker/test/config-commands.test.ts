import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_CANCEL,
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
} from "@opengroow/protocol";
import {
  handleAiConfigSet,
  handleOpenClawExec,
  handleOpenClawExecCancel,
} from "../src/commands/config-commands.js";
import type { Command } from "@opengroow/protocol";

function makeDeps(gatewayResult: Record<string, unknown> = {}) {
  return {
    gatewayClient: {
      requestGatewayControl: vi.fn().mockResolvedValue({
        output: "configured",
        provider: "openai",
        model: "gpt-4o",
        ...gatewayResult,
      }),
    },
    getRuntimeInstanceId: () => "instance-1",
    log: vi.fn(),
    warn: vi.fn(),
  } as any;
}

function makeCommand(payload: Record<string, unknown>): Command {
  return { id: "cmd-1", type: "runtime.ai.config.set", ts: Date.now(), payload };
}

describe("handleAiConfigSet", () => {
  it("includes baseUrl in the result when the payload provides one", async () => {
    const deps = makeDeps();
    const command = makeCommand({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o",
      baseUrl: "https://custom.endpoint/v1",
    });

    const event = await handleAiConfigSet(command, deps);

    expect(event.event.type).toBe(RUNTIME_AI_CONFIG_SET_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: true,
      data: {
        provider: "openai",
        model: "gpt-4o",
        baseUrl: "https://custom.endpoint/v1",
      },
    });
  });

  it("does not include baseUrl when the payload doesn't provide one", async () => {
    const deps = makeDeps();
    const command = makeCommand({
      provider: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-6",
    });

    const event = await handleAiConfigSet(command, deps);

    expect(event.event.payload).toMatchObject({ ok: true });
    expect((event.event.payload as any).data.baseUrl).toBeUndefined();
  });

  it("sends baseUrl to the gateway in the body when present", async () => {
    const deps = makeDeps();
    const command = makeCommand({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o",
      baseUrl: "https://custom.endpoint/v1",
    });

    await handleAiConfigSet(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/ai/config",
      expect.objectContaining({ baseUrl: "https://custom.endpoint/v1" }),
    );
  });

  it("does not send baseUrl to the gateway when absent", async () => {
    const deps = makeDeps();
    const command = makeCommand({ provider: "openai", apiKey: "sk-test", model: "gpt-4o" });

    await handleAiConfigSet(command, deps);

    const body = deps.gatewayClient.requestGatewayControl.mock.calls[0][1];
    expect(body).not.toHaveProperty("baseUrl");
  });
});

describe("handleOpenClawExec", () => {
  it("writes carried workspace files in order before starting the agent", async () => {
    const deps = makeDeps({ output: "done", success: true, exitCode: 0 });
    const command: Command = {
      id: "cmd-exec",
      type: RUNTIME_OPENCLAW_EXEC,
      ts: Date.now(),
      payload: {
        commandText: "openclaw agent run",
        workspaceKey: "ws-1",
        filesToWrite: [
          { filePath: "missions/m1/context.md", content: "context" },
          { filePath: "AGENTS.md", content: "instructions" },
        ],
      },
    };

    await handleOpenClawExec(command, deps);

    expect(deps.gatewayClient.requestGatewayControl.mock.calls).toEqual([
      [
        "/workspace/file/write",
        { workspaceKey: "ws-1", filePath: "missions/m1/context.md", content: "context" },
      ],
      [
        "/workspace/file/write",
        { workspaceKey: "ws-1", filePath: "AGENTS.md", content: "instructions" },
      ],
      ["/openclaw/exec", { commandText: "openclaw agent run", timeoutMs: 30_000 }],
    ]);
  });

  it("returns a failed exec result without starting the agent when a carried write fails", async () => {
    const deps = makeDeps();
    deps.gatewayClient.requestGatewayControl.mockRejectedValueOnce(new Error("disk full"));
    const command: Command = {
      id: "cmd-exec",
      type: RUNTIME_OPENCLAW_EXEC,
      ts: Date.now(),
      payload: {
        commandText: "openclaw agent run",
        workspaceKey: "ws-1",
        filesToWrite: [{ filePath: "AGENTS.md", content: "instructions" }],
      },
    };

    const event = await handleOpenClawExec(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).toHaveBeenCalledTimes(1);
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "Failed to write AGENTS.md before exec: disk full",
    });
  });

  it("refuses carried writes without a workspace key", async () => {
    const deps = makeDeps();
    const command: Command = {
      id: "cmd-exec",
      type: RUNTIME_OPENCLAW_EXEC,
      ts: Date.now(),
      payload: {
        commandText: "openclaw agent run",
        filesToWrite: [{ filePath: "AGENTS.md", content: "instructions" }],
      },
    };

    const event = await handleOpenClawExec(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "workspaceKey is required when filesToWrite is provided",
    });
  });

  it("rejects a malformed carried-write list without starting the agent", async () => {
    const deps = makeDeps();
    const command: Command = {
      id: "cmd-exec",
      type: RUNTIME_OPENCLAW_EXEC,
      ts: Date.now(),
      payload: {
        commandText: "openclaw agent run",
        workspaceKey: "ws-1",
        filesToWrite: [{ filePath: "AGENTS.md" }],
      },
    };

    const event = await handleOpenClawExec(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "filesToWrite must contain only filePath/content string pairs",
    });
  });
});

describe("handleOpenClawExecCancel", () => {
  it("relays the sessionId to the gateway's cancel route and returns a success result", async () => {
    const deps = makeDeps({ cancelled: true });
    const command: Command = {
      id: "cmd-cancel",
      type: RUNTIME_OPENCLAW_EXEC_CANCEL,
      ts: Date.now(),
      payload: { sessionId: "s1" },
    };

    const event = await handleOpenClawExecCancel(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/openclaw/exec/cancel",
      { sessionId: "s1" },
    );
    expect(event.event.type).toBe(RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: true,
      data: { cancelled: true },
    });
  });

  it("returns a failure result when the sessionId is missing, without calling the gateway", async () => {
    const deps = makeDeps();
    const command: Command = {
      id: "cmd-cancel",
      type: RUNTIME_OPENCLAW_EXEC_CANCEL,
      ts: Date.now(),
      payload: {},
    };

    const event = await handleOpenClawExecCancel(command, deps);

    expect(deps.gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    expect(event.event.type).toBe(RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "sessionId is required",
      data: { cancelled: false },
    });
  });

  it("returns a failure result when the gateway relay throws", async () => {
    const deps = makeDeps();
    deps.gatewayClient.requestGatewayControl.mockRejectedValueOnce(new Error("gateway unreachable"));
    const command: Command = {
      id: "cmd-cancel",
      type: RUNTIME_OPENCLAW_EXEC_CANCEL,
      ts: Date.now(),
      payload: { sessionId: "s1" },
    };

    const event = await handleOpenClawExecCancel(command, deps);

    expect(event.event.type).toBe(RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT);
    expect(event.event.payload).toMatchObject({
      ok: false,
      error: "gateway unreachable",
      data: { cancelled: false },
    });
  });
});
