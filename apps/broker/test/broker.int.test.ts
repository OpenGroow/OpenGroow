import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createBrokerServer, type BrokerServer } from "../src/broker.js";
import {
  buildHmacHeaders,
  buildStringToSign,
  sha256Hex,
  signHmac
} from "@opengroow/hmac";

type ConvexEvent = { instanceId: string; event: unknown };
type ConvexAck = { instanceId: string; commandId: string };

const WS_PATH = "/openclaw";
const OPENCLAW_KEY_ID = "dev";
const OPENCLAW_SECRET = "oc-secret";
const OPENCLAW_ID = "openclaw-1";
const CONVEX_KEY_ID = "convex";
const CONVEX_SECRET = "convex-secret";

function buildWsHeaders() {
  const ts = String(Date.now());
  const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
  const signature = signHmac(
    OPENCLAW_SECRET,
    buildStringToSign({ method: "GET", path: WS_PATH, ts, nonce })
  );
  return buildHmacHeaders({ keyId: OPENCLAW_KEY_ID, ts, nonce, signature }, "openclaw");
}

function buildHttpHeaders(body: string) {
  const ts = String(Date.now());
  const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
  const signature = signHmac(
    CONVEX_SECRET,
    buildStringToSign({
      method: "POST",
      path: "/broker/commands",
      ts,
      nonce,
      bodyHash: sha256Hex(body)
    })
  );
  return {
    "content-type": "application/json",
    ...buildHmacHeaders({ keyId: CONVEX_KEY_ID, ts, nonce, signature }, "broker")
  };
}

async function waitForCondition(check: () => boolean, timeoutMs = 1500) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out"));
      }
    }, 10);
  });
}

async function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 1500
) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out"));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function connectOpenClaw(port: number) {
  const headers = buildWsHeaders();
  const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, { headers });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Hello timeout"));
    }, 1500);
    const onOpen = () => {
      ws.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
    };
    const onMessage = (data: WebSocket.RawData) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (parsed?.type === "hello_ok") {
        cleanup();
        resolve();
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("open", onOpen);
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
  return ws;
}

describe("broker integration", () => {
  let broker: BrokerServer;
  let convexEvents: ConvexEvent[];
  let convexAcks: ConvexAck[];

  beforeEach(() => {
    convexEvents = [];
    convexAcks = [];
    broker = createBrokerServer({
      port: 0,
      wsPath: WS_PATH,
      log: false,
      hmacSkewMs: 0,
      nonceTtlMs: 0,
      convex: {
        health: async () => ({ ok: true }),
        ingestEvent: async (instanceId, event) => {
          convexEvents.push({ instanceId, event });
        },
        ackCommand: async (instanceId, commandId) => {
          convexAcks.push({ instanceId, commandId });
        }
      },
      openclawKeys: {
        [OPENCLAW_KEY_ID]: { openClawId: OPENCLAW_ID, secret: OPENCLAW_SECRET }
      },
      convexKeys: {
        [CONVEX_KEY_ID]: { secret: CONVEX_SECRET }
      }
    });
  });

  afterEach(async () => {
    await broker.close();
  });

  it("pushes commands and ingests events over WS", async () => {
    const ws = await connectOpenClaw(broker.port);

    const event = {
      id: "evt_1",
      type: "manual_event",
      payload: { ok: true },
      ts: Date.now()
    };
    ws.send(JSON.stringify({ type: "event", event }));

    await waitForCondition(() => convexEvents.length === 1);
    expect(convexEvents[0]).toMatchObject({ instanceId: OPENCLAW_ID });

    const command = {
      id: "cmd_1",
      type: "runtime.health.check",
      payload: { size: "small" },
      ts: Date.now()
    };
    const body = JSON.stringify({ instanceId: OPENCLAW_ID, command });
    const commandPromise = waitForWsMessage(ws, (msg) => msg?.type === "command");
    const response = await fetch(`http://127.0.0.1:${broker.port}/broker/commands`, {
      method: "POST",
      headers: buildHttpHeaders(body),
      body
    });
    expect(response.status).toBe(200);

    const commandMessage = await commandPromise;
    expect(commandMessage.command.id).toBe(command.id);
    ws.send(JSON.stringify({ type: "command_ack", commandId: command.id }));

    await waitForCondition(() => convexAcks.length === 1);
    expect(convexAcks[0]).toEqual({ instanceId: OPENCLAW_ID, commandId: command.id });

    ws.close();
  });

  it("rejects a command with an invalid runtime shape before dispatch", async () => {
    const ws = await connectOpenClaw(broker.port);
    const body = JSON.stringify({
      instanceId: OPENCLAW_ID,
      command: {
        id: "cmd_invalid",
        type: "runtime.health.check",
        ts: Date.now(),
        payload: "not-an-object"
      }
    });
    const response = await fetch(`http://127.0.0.1:${broker.port}/broker/commands`, {
      method: "POST",
      headers: buildHttpHeaders(body),
      body
    });
    expect(response.status).toBe(400);
    ws.close();
  });

  it("rejects invalid HMAC for broker commands", async () => {
    const command = {
      id: "cmd_bad",
      type: "noop",
      payload: {},
      ts: Date.now()
    };
    const body = JSON.stringify({ instanceId: OPENCLAW_ID, command });
    const ts = String(Date.now());
    const nonce = "bad-nonce";
    const headers = {
      "content-type": "application/json",
      ...buildHmacHeaders(
        { keyId: CONVEX_KEY_ID, ts, nonce, signature: "00" },
        "broker"
      )
    };
    const response = await fetch(`http://127.0.0.1:${broker.port}/broker/commands`, {
      method: "POST",
      headers,
      body
    });
    expect(response.status).toBe(401);
  });
});
