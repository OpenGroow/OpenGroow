import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_ORDER_ACTIVATE,
  RUNTIME_MCP_SERVERS_MERGE,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_NODES_APPROVE,
  RUNTIME_OPENCLAW_EXEC_CANCEL,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_SKILL_FILES,
  type Command,
  type EventMessage,
} from "@opengroow/protocol";
import { CommandRouter } from "../src/commands/command-router";

describe("CommandRouter", () => {
  it("replays the stored result for a duplicate completed command without rerunning the handler", async () => {
    const queuedAcks: string[] = [];
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        output: "configured",
        provider: "openai",
        model: "gpt-4o",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: (commandId: string) => {
          queuedAcks.push(commandId);
        },
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-1",
      type: RUNTIME_AI_CONFIG_SET,
      ts: Date.now(),
      payload: {
        provider: "openai",
        apiKey: "secret",
        model: "gpt-4o",
      },
    };

    await router.handleCommand(command);
    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledTimes(1);
    expect(queuedAcks).toEqual(["cmd-1", "cmd-1"]);
    expect(queuedMessages).toHaveLength(2);
    expect(queuedMessages[0]).toEqual(queuedMessages[1]);
  });

  it("routes speech-to-text config commands to the dedicated control endpoint", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        output: "Groq speech-to-text enabled.",
        provider: "groq",
        enabled: true,
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-stt-1",
      type: RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
      ts: Date.now(),
      payload: {
        provider: "groq",
        enabled: true,
        apiKey: "gsk_secret",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/speech-to-text/config",
      {
        provider: "groq",
        enabled: true,
        apiKey: "gsk_secret",
      },
    );
    expect(queuedMessages).toHaveLength(1);
    expect(queuedMessages[0]?.event.type).toBe(
      "runtime.speech_to_text.config.set.result",
    );
  });

  it("routes node approve commands to the control socket endpoint", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      approvePendingNode: vi.fn().mockResolvedValue({
        output: "Approved device (request-123)",
        requestId: "request-123",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-node-approve-1",
      type: RUNTIME_NODES_APPROVE,
      ts: Date.now(),
      payload: {
        requestId: "request-123",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.approvePendingNode).toHaveBeenCalledWith("request-123");
    expect(queuedMessages).toHaveLength(1);
    expect(queuedMessages[0]?.event.type).toBe("runtime.nodes.approve.result");
  });

  it("routes workspace list commands to the dedicated control endpoint", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        workspaces: [
          {
            workspaceKey: "default-123",
            label: "Default Workspace",
            absolutePath: "/home/node/.openclaw/workspace",
            isActive: true,
            kind: "default",
            availableFiles: [{ filePath: "AGENTS.md", title: "AGENTS", kind: "standard" }],
          },
        ],
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-workspaces-1",
      type: RUNTIME_WORKSPACE_LIST,
      ts: Date.now(),
      payload: {},
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/workspace/list",
      {},
    );
    expect(queuedMessages[0]?.event.type).toBe("runtime.workspace.list.result");
  });

  it("routes workspace file read commands to the dedicated control endpoint", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        workspaceKey: "default-123",
        filePath: "AGENTS.md",
        title: "AGENTS",
        content: "# hi",
        lastModifiedAt: "2026-04-29T12:00:00.000Z",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-workspace-file-1",
      type: RUNTIME_WORKSPACE_FILE_READ,
      ts: Date.now(),
      payload: {
        workspaceKey: "default-123",
        filePath: "AGENTS.md",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/workspace/file",
      {
        workspaceKey: "default-123",
        filePath: "AGENTS.md",
      },
    );
    expect(queuedMessages[0]?.event.type).toBe(
      "runtime.workspace.file.read.result",
    );
  });

  it("routes workspace skill files commands to the dedicated control endpoint", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        workspaceKey: "default-123",
        spec: "cubic/avoid-ai-writing",
        files: [
          {
            filePath: "skills/avoid-ai-writing/SKILL.md",
            title: "SKILL",
            kind: "skill",
          },
        ],
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-workspace-skill-files-1",
      type: RUNTIME_WORKSPACE_SKILL_FILES,
      ts: Date.now(),
      payload: {
        workspaceKey: "default-123",
        spec: "cubic/avoid-ai-writing",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/workspace/skill/files",
      {
        workspaceKey: "default-123",
        spec: "cubic/avoid-ai-writing",
      },
    );
    expect(queuedMessages[0]?.event.type).toBe(
      "runtime.workspace.skill_files.result",
    );
  });

  it("routes workspace create commands to POST /workspace/create", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        workspaceKey: "seo-agent",
        label: "SEO Agent",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-create-1",
      type: RUNTIME_WORKSPACE_CREATE,
      ts: Date.now(),
      payload: {
        workspaceKey: "seo-agent",
        label: "SEO Agent",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/workspace/create",
      { workspaceKey: "seo-agent", label: "SEO Agent" },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.create.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-ws-create-1",
      instanceId: "instance-123",
      ok: true,
      data: { workspaceKey: "seo-agent", label: "SEO Agent" },
    });
  });

  it("returns error result when workspace create fails", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockRejectedValue(new Error("Gateway unreachable")),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-create-err",
      type: RUNTIME_WORKSPACE_CREATE,
      ts: Date.now(),
      payload: { workspaceKey: "seo-agent", label: "SEO Agent" },
    };

    await router.handleCommand(command);

    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.create.result");
    expect(result?.event.payload).toMatchObject({
      ok: false,
      error: "Gateway unreachable",
    });
  });

  it("returns validation error when workspace create payload is missing fields", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn(),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-create-invalid",
      type: RUNTIME_WORKSPACE_CREATE,
      ts: Date.now(),
      payload: {},
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.create.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("routes workspace file write commands to POST /workspace/file/write", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        workspaceKey: "seo-agent",
        filePath: "NOTES.md",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-file-write-1",
      type: RUNTIME_WORKSPACE_FILE_WRITE,
      ts: Date.now(),
      payload: {
        workspaceKey: "seo-agent",
        filePath: "NOTES.md",
        content: "# SEO Notes",
      },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/workspace/file/write",
      { workspaceKey: "seo-agent", filePath: "NOTES.md", content: "# SEO Notes" },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.file.write.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-ws-file-write-1",
      instanceId: "instance-123",
      ok: true,
      data: { workspaceKey: "seo-agent", filePath: "NOTES.md" },
    });
  });

  it("returns error result when workspace file write fails", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockRejectedValue(new Error("Disk full")),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-file-write-err",
      type: RUNTIME_WORKSPACE_FILE_WRITE,
      ts: Date.now(),
      payload: { workspaceKey: "seo-agent", filePath: "NOTES.md", content: "data" },
    };

    await router.handleCommand(command);

    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.file.write.result");
    expect(result?.event.payload).toMatchObject({
      ok: false,
      error: "Disk full",
    });
  });

  it("returns validation error when workspace file write payload is missing fields", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn(),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-ws-file-write-invalid",
      type: RUNTIME_WORKSPACE_FILE_WRITE,
      ts: Date.now(),
      payload: { workspaceKey: "seo-agent" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.workspace.file.write.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("routes mcp servers merge commands to POST /mcp/servers/merge", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        mergedKeys: ["brave-search", "image-gen"],
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const servers = {
      "brave-search": { command: "npx", args: ["-y", "brave-search-mcp"] },
      "image-gen": { command: "npx", args: ["-y", "image-gen-mcp"] },
    };

    const command: Command = {
      id: "cmd-mcp-merge-1",
      type: RUNTIME_MCP_SERVERS_MERGE,
      ts: Date.now(),
      payload: { servers },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/mcp/servers/merge",
      { servers },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.merge.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-mcp-merge-1",
      instanceId: "instance-123",
      ok: true,
      data: { mergedKeys: ["brave-search", "image-gen"] },
    });
  });

  it("returns error result when mcp servers merge fails", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockRejectedValue(new Error("Config locked")),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-merge-err",
      type: RUNTIME_MCP_SERVERS_MERGE,
      ts: Date.now(),
      payload: { servers: { "brave-search": { command: "npx" } } },
    };

    await router.handleCommand(command);

    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.merge.result");
    expect(result?.event.payload).toMatchObject({
      ok: false,
      error: "Config locked",
    });
  });

  it("returns validation error when mcp servers merge payload is missing servers", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn(),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-merge-invalid",
      type: RUNTIME_MCP_SERVERS_MERGE,
      ts: Date.now(),
      payload: {},
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.merge.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("returns validation error when mcp servers merge payload has empty servers object", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = { requestGatewayControl: vi.fn() };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => { queuedMessages.push(message); },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-merge-empty",
      type: RUNTIME_MCP_SERVERS_MERGE,
      ts: Date.now(),
      payload: { servers: {} },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.merge.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("routes mcp servers remove commands to POST /mcp/servers/remove", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        removedKeys: ["brave-search"],
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-remove-1",
      type: RUNTIME_MCP_SERVERS_REMOVE,
      ts: Date.now(),
      payload: { keys: ["brave-search"] },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/mcp/servers/remove",
      { keys: ["brave-search"] },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.remove.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-mcp-remove-1",
      instanceId: "instance-123",
      ok: true,
      data: { removedKeys: ["brave-search"] },
    });
  });

  it("returns error result when mcp servers remove fails", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockRejectedValue(new Error("Permission denied")),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-remove-err",
      type: RUNTIME_MCP_SERVERS_REMOVE,
      ts: Date.now(),
      payload: { keys: ["brave-search"] },
    };

    await router.handleCommand(command);

    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.remove.result");
    expect(result?.event.payload).toMatchObject({
      ok: false,
      error: "Permission denied",
    });
  });

  it("returns validation error when mcp servers remove payload is missing keys", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn(),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-remove-invalid",
      type: RUNTIME_MCP_SERVERS_REMOVE,
      ts: Date.now(),
      payload: {},
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.remove.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("forwards an explicit model override to POST /auth/activate", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "openai/gpt-5.5-mini",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-auth-activate-model-1",
      type: RUNTIME_AUTH_ACTIVATE,
      ts: Date.now(),
      payload: { provider: "openai", model: "openai/gpt-5.5-mini" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/auth/activate",
      { provider: "openai", model: "openai/gpt-5.5-mini" },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.auth.activate.result");
    expect(result?.event.payload).toMatchObject({
      ok: true,
      data: { provider: "openai", model: "openai/gpt-5.5-mini" },
    });
  });

  it("omits model from POST /auth/activate when not provided", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "openai/gpt-5.5",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-auth-activate-no-model-1",
      type: RUNTIME_AUTH_ACTIVATE,
      ts: Date.now(),
      payload: { provider: "openai" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/auth/activate",
      { provider: "openai" },
    );
  });

  it("routes auth order activate commands to POST /auth/order-activate", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({
        provider: "openai",
        kind: "apikey",
        model: "openai/gpt-5.5",
        profileId: "openai:default",
      }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-auth-order-1",
      type: RUNTIME_AUTH_ORDER_ACTIVATE,
      ts: Date.now(),
      payload: { provider: "openai", kind: "apikey", model: "openai/gpt-5.5" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/auth/order-activate",
      { provider: "openai", kind: "apikey", model: "openai/gpt-5.5" },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.auth.order-activate.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-auth-order-1",
      instanceId: "instance-123",
      ok: true,
      data: { provider: "openai", kind: "apikey", profileId: "openai:default" },
    });
  });

  it("returns validation error when auth order activate payload is missing kind/model", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = { requestGatewayControl: vi.fn() };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-auth-order-invalid",
      type: RUNTIME_AUTH_ORDER_ACTIVATE,
      ts: Date.now(),
      payload: { provider: "openai" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.auth.order-activate.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("returns validation error when mcp servers remove payload has only empty string keys", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = { requestGatewayControl: vi.fn() };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => { queuedMessages.push(message); },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-mcp-remove-empty-keys",
      type: RUNTIME_MCP_SERVERS_REMOVE,
      ts: Date.now(),
      payload: { keys: ["", "   "] },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).not.toHaveBeenCalled();
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.mcp.servers.remove.result");
    expect(result?.event.payload).toMatchObject({ ok: false });
  });

  it("routes openclaw exec cancel commands to POST /openclaw/exec/cancel", async () => {
    const queuedMessages: EventMessage[] = [];
    const gatewayClient = {
      requestGatewayControl: vi.fn().mockResolvedValue({ cancelled: true }),
    };

    const router = new CommandRouter({
      broker: {
        enqueueAck: () => {},
        enqueueMessage: (message: EventMessage) => {
          queuedMessages.push(message);
        },
      } as any,
      gatewayClient: gatewayClient as any,
      openclawRunner: {} as any,
      getRuntimeInstanceId: () => "instance-123",
      log: () => {},
      warn: () => {},
    });

    const command: Command = {
      id: "cmd-exec-cancel-1",
      type: RUNTIME_OPENCLAW_EXEC_CANCEL,
      ts: Date.now(),
      payload: { sessionId: "s1" },
    };

    await router.handleCommand(command);

    expect(gatewayClient.requestGatewayControl).toHaveBeenCalledWith(
      "/openclaw/exec/cancel",
      { sessionId: "s1" },
    );
    const result = queuedMessages[0];
    expect(result?.event.type).toBe("runtime.openclaw.exec.cancel.result");
    expect(result?.event.payload).toMatchObject({
      commandId: "cmd-exec-cancel-1",
      instanceId: "instance-123",
      ok: true,
      data: { cancelled: true },
    });
  });
});
