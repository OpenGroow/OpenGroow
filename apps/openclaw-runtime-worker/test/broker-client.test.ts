import { describe, expect, it } from "vitest";
import { BrokerClient } from "../src/broker/broker-client";
import { WebSocketServer, type WebSocket } from "ws";
import type { RuntimeWorkerConfig } from "../src/config/runtime-worker-config";

const config: RuntimeWorkerConfig = {
  brokerWsUrl: "ws://127.0.0.1:4300/openclaw",
  openclawKeyId: "key-id",
  openclawSecret: "secret",
  openclawControlSocketPath: "/tmp/openclaw.sock",
  openclawGatewayLocalPort: 18789,
  openclawInstanceId: "instance-123",
};

function createClient() {
  return new BrokerClient({
    config,
    log: () => {},
    warn: () => {},
    onCommand: () => {},
    onRelayOpen: () => {},
    onRelayData: () => {},
    onRelayClose: () => {},
    onDisconnected: () => {},
  });
}

describe("BrokerClient delivery queue", () => {
  it("queues a message while the socket is not ready and flushes it later", async () => {
    const client = createClient();
    const sent: Array<{ type: string; commandId?: string }> = [];
    const clientAny = client as any;

    client.enqueueAck("cmd-1");

    clientAny.socket = {
      readyState: 1,
      send: (payload: string, callback?: (error?: Error) => void) => {
        sent.push(JSON.parse(payload));
        callback?.();
      },
    };
    clientAny.helloComplete = true;

    await clientAny.flushOutbox();

    expect(sent).toEqual([{ type: "command_ack", commandId: "cmd-1" }]);
  });

  it("does not lose the head message if the connection drops during flush", async () => {
    const client = createClient();
    const clientAny = client as any;
    const sent: Array<{ type: string; commandId?: string }> = [];

    client.enqueueAck("cmd-1");
    client.enqueueAck("cmd-2");

    const firstSocket = {
      readyState: 1,
      send: (_payload: string, callback?: (error?: Error) => void) => {
        firstSocket.readyState = 3;
        clientAny.helloComplete = false;
        callback?.(new Error("socket closed"));
      },
    };

    clientAny.socket = firstSocket;
    clientAny.helloComplete = true;
    await clientAny.flushOutbox();

    const secondSocket = {
      readyState: 1,
      send: (payload: string, callback?: (error?: Error) => void) => {
        sent.push(JSON.parse(payload));
        callback?.();
      },
    };

    clientAny.socket = secondSocket;
    clientAny.helloComplete = true;
    await clientAny.flushOutbox();

    expect(sent).toEqual([
      { type: "command_ack", commandId: "cmd-1" },
      { type: "command_ack", commandId: "cmd-2" },
    ]);
  });

  it("does not invoke the command callback for an invalid command envelope", async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = (server.address() as { port: number }).port;
    let commandCount = 0;
    const warnings: string[] = [];
    const client = new BrokerClient({
      config: { ...config, brokerWsUrl: `ws://127.0.0.1:${port}` },
      log: () => {},
      warn: (message) => warnings.push(message),
      onCommand: () => { commandCount += 1; },
      onRelayOpen: () => {},
      onRelayData: () => {},
      onRelayClose: () => {},
      onDisconnected: () => {},
    });
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "hello_ok", instanceId: "instance-123", heartbeatIntervalMs: 1000, protocolVersion: 1 }));
      socket.send(JSON.stringify({ type: "command", command: { id: "bad", type: "runtime.health.check", ts: Date.now(), payload: "invalid" } }));
    });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(commandCount).toBe(0);
    expect(warnings).toContain("received invalid broker message");
    clientAnySocket(client)?.close();
    const reconnectTimer = (client as any).reconnectTimer as NodeJS.Timeout | null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function clientAnySocket(client: BrokerClient): WebSocket | null {
  return (client as any).socket ?? null;
}
