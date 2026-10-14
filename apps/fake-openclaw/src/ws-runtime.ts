import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildHmacHeaders, buildStringToSign, signHmac } from "@opengroow/hmac";
import { type Command } from "@opengroow/protocol";
import { createMissionAwareDispatcher } from "./openclaw-agent.js";

const dispatch = createMissionAwareDispatcher();

const BROKER_WS_URL = process.env.BROKER_WS_URL ?? "ws://127.0.0.1:4300/openclaw";
const OPENCLAW_KEY_ID = process.env.OPENCLAW_KEY_ID ?? "dev";
const OPENCLAW_SECRET = process.env.OPENCLAW_SECRET ?? "dev-secret";
const PROTOCOL_VERSION = 1;
const INSTANCE_ID = process.env.OPENCLAW_INSTANCE_ID ?? "openclaw-dev-1";

let socket: WebSocket | null = null;
let backoffMs = 1000;
let heartbeatTimer: NodeJS.Timeout | null = null;

function signWs(url: URL, ts: string, nonce: string): string {
  const stringToSign = buildStringToSign({
    method: "GET",
    path: url.pathname,
    ts,
    nonce
  });
  return signHmac(OPENCLAW_SECRET, stringToSign);
}

export function startOpenClawWs(): void {
  connect();
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function sendEvent(event: {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
}): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  sendJson({ type: "event", event });
  return true;
}

function connect(): void {
  const url = new URL(BROKER_WS_URL);
  const ts = String(Date.now());
  const nonce = randomUUID();
  const signature = signWs(url, ts, nonce);

  const ws = new WebSocket(url.toString(), {
    headers: buildHmacHeaders(
      {
        keyId: OPENCLAW_KEY_ID,
        ts,
        nonce,
        signature
      },
      "openclaw"
    )
  });

  socket = ws;

  ws.on("open", () => {
    backoffMs = 1000;
    ws.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION }));
    console.log("[fake-openclaw] connected");
  });

  ws.on("message", (data) => {
    let parsed: any;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      console.warn("[fake-openclaw] invalid JSON");
      return;
    }

    if (parsed?.type === "hello_ok") {
      console.log("[fake-openclaw] hello_ok", parsed.instanceId);
      startHeartbeat(ws, Number(parsed.heartbeatIntervalMs ?? 5000));
      return;
    }

    if (parsed?.type === "pong") {
      return;
    }

    if (parsed?.type === "command") {
      console.log("[fake-openclaw] command received", parsed.command);
      const command = parsed.command as Command | undefined;
      if (command?.id) {
        sendJson({ type: "command_ack", commandId: command.id });
      }
      const event = command ? dispatch(command, INSTANCE_ID) : null;
      if (event) {
        sendEvent(event);
      } else {
        sendEvent({
          id: `evt_${command?.id ?? Date.now()}`,
          type: "command_received",
          payload: { command },
          ts: Date.now()
        });
      }
      return;
    }
  });

  ws.on("close", () => {
    stopHeartbeat();
    console.warn("[fake-openclaw] disconnected, retrying...");
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 10_000);
  });

  ws.on("error", (err) => {
    console.warn("[fake-openclaw] ws error", err);
  });
}

function startHeartbeat(ws: WebSocket, intervalMs: number): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    sendJson({ type: "ping", ts: Date.now() });
    if (process.env.OPENCLAW_SEND_EVENT === "1") {
      sendEvent({
        id: `evt_${Date.now()}`,
        type: "heartbeat",
        payload: { ok: true },
        ts: Date.now()
      });
    }
  }, intervalMs);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendJson(payload: unknown): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
