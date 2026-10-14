import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createNodeWorkflow } = require("../docker/control-socket-node-workflow.js") as {
  createNodeWorkflow: (options: Record<string, unknown>) => any;
};
const { createChannelWorkflow } = require("../docker/control-socket-channel-workflow.js") as {
  createChannelWorkflow: (options: Record<string, unknown>) => any;
};
const { createWhatsAppWorkflow } = require("../docker/control-socket-whatsapp-workflow.js") as {
  createWhatsAppWorkflow: (options: Record<string, unknown>) => any;
};

describe("node workflow", () => {
  it("combines legacy pending data with relay requests and cleans stuck nodes", async () => {
    const fs = { readFile: vi.fn().mockResolvedValue(JSON.stringify({ legacy: { deviceId: "legacy-device" } })) };
    const runGatewayNodeCommand = vi.fn(async (args: string[]) => {
      if (args[0] === "nodes" && args[1] === "list") {
        return {
          stdout: JSON.stringify({
            paired: [
              { nodeId: "stuck", connected: true, approvalState: "unapproved", caps: [] },
              { nodeId: "pending", connected: true, approvalState: "pending-approval", caps: [] },
            ],
          }),
          stderr: "",
        };
      }
      if (args[1] === "describe") {
        return {
          stdout: "Run openclaw nodes approve 12345678-1234-1234-1234-123456789abc",
          stderr: "",
        };
      }
      return { stdout: "removed", stderr: "" };
    });
    const workflow = createNodeWorkflow({
      fs,
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing: vi.fn(),
      configTimeoutMs: 60_000,
    });

    const result = await workflow.pendingList();
    expect(result.body.data.legacy).toContain("legacy-device");
    expect(result.body.data.relayRequestIds).toEqual(["12345678-1234-1234-1234-123456789abc"]);
    expect(runGatewayNodeCommand).toHaveBeenCalledWith(["nodes", "remove", "--node", "stuck"], 60_000);
  });

  it("falls back from modern approval to the gateway device approval adapter", async () => {
    const approveGatewayDevicePairing = vi.fn().mockResolvedValue({ requestId: "legacy-request" });
    const runGatewayNodeCommand = vi.fn().mockRejectedValue(new Error("unknown requestId"));
    const workflow = createNodeWorkflow({
      fs: { readFile: vi.fn() },
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing,
      configTimeoutMs: 60_000,
    });

    const result = await workflow.approve({ requestId: "legacy-request" });
    expect(result.body.data.output).toContain("legacy-request");
    expect(approveGatewayDevicePairing).toHaveBeenCalledWith("legacy-request", { timeoutMs: 60_000 });
  });

  it("check() reports connected system nodes and repairs stuck unapproved ones", async () => {
    const fs = { readFile: vi.fn().mockResolvedValue("{}") };
    const runGatewayNodeCommand = vi.fn(async (args: string[]) => {
      if (args[0] === "nodes" && args[1] === "list") {
        return {
          stdout: JSON.stringify({
            paired: [
              { nodeId: "a", displayName: "Node A", connected: true, approvalState: "approved", caps: ["system"] },
              { nodeId: "stuck", connected: true, approvalState: "unapproved", caps: [] },
            ],
          }),
          stderr: "",
        };
      }
      return { stdout: "removed", stderr: "" };
    });
    const workflow = createNodeWorkflow({
      fs,
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing: vi.fn(),
      configTimeoutMs: 60_000,
    });

    const result = await workflow.check();
    expect(result.body.data.connectedCount).toBe(1);
    expect(result.body.data.nodes).toEqual([{ displayName: "Node A", caps: ["system"] }]);
    expect(result.body.data.repairing).toBe(true);
    expect(runGatewayNodeCommand).toHaveBeenCalledWith(["nodes", "remove", "--node", "stuck"], 60_000);
  });

  it("check() treats malformed nodes list output as an empty connected set", async () => {
    const runGatewayNodeCommand = vi.fn().mockResolvedValue({ stdout: "not json", stderr: "" });
    const workflow = createNodeWorkflow({
      fs: { readFile: vi.fn().mockResolvedValue("{}") },
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing: vi.fn(),
      configTimeoutMs: 60_000,
    });

    const result = await workflow.check();
    expect(result.body.data.connectedCount).toBe(0);
    expect(result.body.data.repairing).toBe(false);
  });

  it("cleanupStale() removes disconnected non-approved nodes and counts them", async () => {
    const runGatewayNodeCommand = vi.fn(async (args: string[]) => {
      if (args[0] === "nodes" && args[1] === "list") {
        return {
          stdout: JSON.stringify({
            paired: [
              { nodeId: "gone", connected: false, approvalState: "pending-approval" },
              { nodeId: "kept", connected: true, approvalState: "approved" },
            ],
          }),
          stderr: "",
        };
      }
      return { stdout: "removed", stderr: "" };
    });
    const workflow = createNodeWorkflow({
      fs: { readFile: vi.fn() },
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing: vi.fn(),
      configTimeoutMs: 60_000,
    });

    const result = await workflow.cleanupStale();
    expect(result.body.data.removedCount).toBe(1);
    expect(runGatewayNodeCommand).toHaveBeenCalledWith(["nodes", "remove", "--node", "gone"], 60_000);
  });

  it("cleanupStale() treats malformed nodes list output as nothing safe to delete", async () => {
    const runGatewayNodeCommand = vi.fn().mockResolvedValue({ stdout: "not json", stderr: "" });
    const workflow = createNodeWorkflow({
      fs: { readFile: vi.fn() },
      pendingDevicesPath: "/pending.json",
      runGatewayNodeCommand,
      approveGatewayDevicePairing: vi.fn(),
      configTimeoutMs: 60_000,
    });

    const result = await workflow.cleanupStale();
    expect(result.body.data.removedCount).toBe(0);
  });
});

describe("channel workflow", () => {
  it("validates channel input before invoking OpenClaw", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    expect((await workflow.configureWhatsApp({ phoneNumber: "not-e164" })).status).toBe(400);
    expect((await workflow.configureTelegram({ botToken: "" })).status).toBe(400);
    expect(runCommandCapture).not.toHaveBeenCalled();
  });

  it("applies AI provider configuration through the injected command runner", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureAi({ provider: "openai", model: "openai/gpt-5.5", apiKey: "sk-test" });
    expect(result.body.data.provider).toBe("openai");
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      ["config", "set", "--json", "agents.defaults.model", JSON.stringify({ primary: "openai/gpt-5.5" })],
      60_000,
    );
  });

  it("propagates a rejected OpenClaw command so the route adapter maps it to a 500", async () => {
    const runCommandCapture = vi.fn().mockRejectedValue(new Error("openclaw exited with code 1"));
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    // Channel workflow operations don't catch command failures themselves —
    // handleWorkflowRoute's try/catch in control-socket-server.js is what
    // turns this rejection into a 500 response.
    await expect(workflow.configureTelegram({ botToken: "123:abc" })).rejects.toThrow(
      "openclaw exited with code 1",
    );
  });

  it("disables WhatsApp without discarding the existing dmPolicy/allowFrom", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue({
        dmPolicy: "allowlist",
        allowFrom: ["+33612345678"],
        selfChatMode: true,
      }),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureWhatsApp({ enabled: false });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      ["config", "set", "--merge", "--json", "channels.whatsapp", JSON.stringify({ enabled: false })],
      60_000,
    );
  });

  it("re-enables WhatsApp the same way it disables it", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureWhatsApp({ enabled: true });

    expect(result.status).toBe(200);
    expect(result.body.data.output).toBe("WhatsApp channel enabled.");
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      ["config", "set", "--merge", "--json", "channels.whatsapp", JSON.stringify({ enabled: true })],
      60_000,
    );
  });

  it("still sets a self-chat phone number the same way when enabled isn't part of the call", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureWhatsApp({ phoneNumber: "+33612345678" });

    expect(result.status).toBe(200);
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      [
        "config",
        "set",
        "--merge",
        "--json",
        "channels.whatsapp",
        JSON.stringify({ dmPolicy: "allowlist", allowFrom: ["+33612345678"], selfChatMode: true }),
      ],
      60_000,
    );
  });

  it("accumulates allowFrom instead of overwriting it when a second self-chat number is saved", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue({
        dmPolicy: "allowlist",
        allowFrom: ["+33612345678"],
        selfChatMode: true,
      }),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureWhatsApp({ phoneNumber: "+33698765432" });

    expect(result.status).toBe(200);
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      [
        "config",
        "set",
        "--merge",
        "--json",
        "channels.whatsapp",
        JSON.stringify({
          dmPolicy: "allowlist",
          allowFrom: ["+33612345678", "+33698765432"],
          selfChatMode: true,
        }),
      ],
      60_000,
    );
  });

  it("clears allowFrom when resetting to pairing mode, instead of leaving stale numbers merged in", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue({
        dmPolicy: "allowlist",
        allowFrom: ["+33612345678"],
        selfChatMode: true,
      }),
      configTimeoutMs: 60_000,
      log: vi.fn(),
    });

    const result = await workflow.configureWhatsApp({ phoneNumber: "" });

    expect(result.status).toBe(200);
    expect(runCommandCapture).toHaveBeenCalledWith(
      "openclaw",
      [
        "config",
        "set",
        "--merge",
        "--json",
        "channels.whatsapp",
        // selfChatMode must be cleared explicitly too — --merge only overwrites keys
        // present here, so a prior self-chat setup would otherwise survive the reset.
        JSON.stringify({ dmPolicy: "pairing", allowFrom: [], selfChatMode: false }),
      ],
      60_000,
    );
  });

  it("schedules a gateway restart after a config change, since the channel doesn't hot-reload", async () => {
    const runCommandCapture = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const scheduleGatewayContainerRestart = vi.fn();
    const workflow = createChannelWorkflow({
      runCommandCapture,
      readOpenClawConfigValue: vi.fn().mockResolvedValue(""),
      configTimeoutMs: 60_000,
      log: vi.fn(),
      scheduleGatewayContainerRestart,
    });

    const result = await workflow.configureWhatsApp({ enabled: false });

    expect(result.afterResponse).toBe(scheduleGatewayContainerRestart);
    expect(scheduleGatewayContainerRestart).not.toHaveBeenCalled();
  });
});

describe("WhatsApp workflow", () => {
  it("owns pairing process state and returns the existing-link response shape", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const runCommandCapture = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "channels" && args[1] === "status") {
        return {
          stdout: JSON.stringify({ channelAccounts: { whatsapp: [{ linked: true, connected: true, accountId: "default", running: true }] } }),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });
    const workflow = createWhatsAppWorkflow({
      fs: { rm: vi.fn().mockResolvedValue(undefined) },
      runCommandCapture,
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("credentials saved\n"));
          child.emit("close", 0);
        });
        return child;
      }),
      resolveOpenClawBinaryAndEnv: () => ({ binary: "openclaw", env: {} }),
      scheduleGatewayContainerRestart: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveAuthDir: () => "/tmp/whatsapp-auth",
      log: vi.fn(),
      warn: vi.fn(),
    });

    const result = await workflow.pairStart({ timeoutMs: 1_000 });
    expect(result.body.data.linked).toBe(true);
    expect(result.body.data.output).toContain("credentials saved");
  });

  it("returns a QR data URL once one is decoded from the login output", async () => {
    const UNICODE_QR_OUTPUT = [
      "Waiting for WhatsApp connection...",
      "Open the WhatsApp app, go to Linked Devices, then scan this QR:",
      " ▄▄▄▄▄▄▄ ▄      ▄▄   ▄▄   ▄  ▄ ▄▄▄  ▄ ▄▄  ▄▄▄▄▄      ▄  ▄  ▄▄▄▄▄▄▄",
      " █ ▄▄▄ █ ██▀▀▄ ▀▀██▄█ ██▄█▀▀▄ ██ ▀  ▀▄▄   ██▄▄ ▀▄▀▄▀▄█ ▄ █ █ ▄▄▄ █",
      " █▄▄▄▄▄█ ▄▀█ █ █▀█▀▄▀▄▀█ ▄▀▄ █ █ ▄ █▀▄ █ █▀▄ █▀▄▀█ █ ▄▀█ ▄ █▄▄▄▄▄█",
      "",
    ].join("\n");
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const runCommandCapture = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ channelAccounts: {} }),
      stderr: "",
    });
    const workflow = createWhatsAppWorkflow({
      fs: { rm: vi.fn().mockResolvedValue(undefined) },
      runCommandCapture,
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from(UNICODE_QR_OUTPUT));
        });
        return child;
      }),
      resolveOpenClawBinaryAndEnv: () => ({ binary: "openclaw", env: {} }),
      scheduleGatewayContainerRestart: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveAuthDir: () => "/tmp/whatsapp-auth",
      log: vi.fn(),
      warn: vi.fn(),
    });

    const result = await workflow.pairStart({ timeoutMs: 1_000 });
    expect(result.body.data.linked).toBe(false);
    expect(result.body.data.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("reports how long the current QR stays valid, as a duration", async () => {
    const QR_OUTPUT = [
      "Open the WhatsApp app, go to Linked Devices, then scan this QR:",
      " ▄▄▄▄▄▄▄ ▄      ▄▄   ▄▄   ▄  ▄ ▄▄▄  ▄ ▄▄  ▄▄▄▄▄      ▄  ▄  ▄▄▄▄▄▄▄",
      " █ ▄▄▄ █ ██▀▀▄ ▀▀██▄█ ██▄█▀▀▄ ██ ▀  ▀▄▄   ██▄▄ ▀▄▀▄▀▄█ ▄ █ █ ▄▄▄ █",
      " █▄▄▄▄▄█ ▄▀█ █ █▀█▀▄▀▄▀█ ▄▀▄ █ █ ▄ █▀▄ █ █▀▄ █▀▄▀█ █ ▄▀█ ▄ █▄▄▄▄▄█",
      "",
    ].join("\n");
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    let clock = 1_000_000;
    const workflow = createWhatsAppWorkflow({
      fs: { rm: vi.fn().mockResolvedValue(undefined) },
      runCommandCapture: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ channelAccounts: { whatsapp: [{ linked: false, connected: false, accountId: "default" }] } }),
        stderr: "",
      }),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(QR_OUTPUT)));
        return child;
      }),
      resolveOpenClawBinaryAndEnv: () => ({ binary: "openclaw", env: {} }),
      scheduleGatewayContainerRestart: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => clock,
      resolveAuthDir: () => "/tmp/whatsapp-auth",
      log: vi.fn(),
      warn: vi.fn(),
    });

    const started = await workflow.pairStart({ timeoutMs: 1_000 });
    expect(started.body.data.qrExpiresInMs).toBe(20_000);

    clock += 12_000;
    const waited = await workflow.pairWait({ timeoutMs: 1 });
    expect(waited.body.data.qrExpiresInMs).toBe(8_000);

    clock += 30_000;
    const late = await workflow.pairWait({ timeoutMs: 1 });
    expect(late.body.data.qrExpiresInMs).toBe(0);
  });

  it("surfaces a login process spawn error instead of hanging", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const workflow = createWhatsAppWorkflow({
      fs: { rm: vi.fn().mockResolvedValue(undefined) },
      runCommandCapture: vi.fn(),
      spawnProcess: vi.fn(() => {
        queueMicrotask(() => {
          child.emit("error", new Error("ENOENT: openclaw binary not found"));
        });
        return child;
      }),
      resolveOpenClawBinaryAndEnv: () => ({ binary: "openclaw", env: {} }),
      scheduleGatewayContainerRestart: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveAuthDir: () => "/tmp/whatsapp-auth",
      log: vi.fn(),
      warn: vi.fn(),
    });

    await expect(workflow.pairStart({ timeoutMs: 1_000 })).rejects.toThrow(
      "ENOENT: openclaw binary not found",
    );
  });
});
