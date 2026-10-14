import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  buildHmacHeaders,
  buildStringToSign,
  signHmac,
} from "@opengroow/hmac";
import {
  PROTOCOL_VERSION,
  parseValidatedMessage,
  assertNever,
  type EventMessage,
  type OpenClawToBrokerMessage,
} from "@opengroow/protocol";
import type { RuntimeWorkerConfig } from "../config/runtime-worker-config.js";
import { MessageOutbox } from "./outbox.js";

import type {
  Command,
  RelayOpenMessage,
  RelayDataMessage,
  RelayCloseMessage,
} from "@opengroow/protocol";

type BrokerClientOptions = {
  config: RuntimeWorkerConfig;
  log: (message: string) => void;
  warn: (message: string) => void;
  onCommand: (command: Command) => void;
  onRelayOpen: (message: RelayOpenMessage) => void;
  onRelayData: (message: RelayDataMessage) => void;
  onRelayClose: (message: RelayCloseMessage) => void;
  onDisconnected: () => void;
};

const CONNECT_TIMEOUT_MS = 10_000;

export class BrokerClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectBackoffMs = 1_000;
  private helloComplete = false;
  private flushing = false;
  private runtimeInstanceId: string;
  private readonly outbox = new MessageOutbox();

  constructor(private readonly options: BrokerClientOptions) {
    this.runtimeInstanceId = options.config.openclawInstanceId;
  }

  start(): void {
    this.connect();
  }

  getRuntimeInstanceId(): string {
    return this.runtimeInstanceId;
  }

  enqueueAck(commandId: string): void {
    this.enqueueForDelivery({
      type: "command_ack",
      commandId,
    });
  }

  enqueueEvent(event: EventMessage["event"]): void {
    this.enqueueForDelivery({
      type: "event",
      event,
    });
  }

  enqueueMessage(message: OpenClawToBrokerMessage): void {
    this.enqueueForDelivery(message);
  }

  sendImmediate(message: OpenClawToBrokerMessage): void {
    if (!this.isReady()) {
      return;
    }
    void this.sendOverSocket(message).catch((error: unknown) => {
      this.options.warn(
        `failed to send immediate broker message: ${error instanceof Error ? error.message : "unknown"}`,
      );
    });
  }

  private signWs(url: URL, ts: string, nonce: string): string {
    const stringToSign = buildStringToSign({
      method: "GET",
      path: url.pathname,
      ts,
      nonce,
    });
    return signHmac(this.options.config.openclawSecret, stringToSign);
  }

  private connect(): void {
    const url = new URL(this.options.config.brokerWsUrl);
    const ts = String(Date.now());
    const nonce = randomUUID();
    const signature = this.signWs(url, ts, nonce);

    const ws = new WebSocket(url.toString(), {
      headers: buildHmacHeaders(
        {
          keyId: this.options.config.openclawKeyId,
          ts,
          nonce,
          signature,
        },
        "openclaw",
      ),
      // Without this, a connection attempt whose TCP handshake never
      // resolves (e.g. the broker mid-restart, packets black-holed instead
      // of refused) hangs forever: neither "open", "close", nor "error"
      // ever fires, so the reconnect loop — which only reschedules itself
      // from the "close" handler — never gets another chance to run.
      handshakeTimeout: CONNECT_TIMEOUT_MS,
    });

    this.socket = ws;
    this.helloComplete = false;

    ws.on("open", () => {
      if (this.socket !== ws) {
        return;
      }
      this.reconnectBackoffMs = 1_000;
      this.sendRaw({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
      });
      this.options.log("connected to broker");
    });

    ws.on("message", (data) => {
      if (this.socket !== ws) {
        return;
      }
      let parsed: ReturnType<typeof parseValidatedMessage>;
      try {
        const raw: unknown = JSON.parse(data.toString("utf8"));
        parsed = parseValidatedMessage(raw, "runtime");
      } catch (error) {
        this.options.warn(error instanceof SyntaxError ? "received invalid JSON" : "received invalid broker message");
        return;
      }

      // Exhaustive switch over all Message members
      switch (parsed.type) {
        case "hello_ok":
          this.runtimeInstanceId = parsed.instanceId;
          this.helloComplete = true;
          this.startHeartbeat(parsed.heartbeatIntervalMs);
          this.options.log(`hello_ok instanceId=${this.runtimeInstanceId}`);
          void this.flushOutbox();
          return;
        case "pong":
          return;
        case "relay_open":
          this.options.onRelayOpen(parsed);
          return;
        case "relay_data":
          this.options.onRelayData(parsed);
          return;
        case "relay_close":
          this.options.onRelayClose(parsed);
          return;
        case "relay_error":
          this.options.warn(
            `relay error sessionId=${parsed.sessionId} error=${parsed.error}`,
          );
          this.options.onRelayClose({
            type: "relay_close",
            sessionId: parsed.sessionId,
            code: 1011,
            reason: parsed.error,
          });
          return;
        case "command":
          this.options.onCommand(parsed.command);
          return;
        case "error":
          this.options.warn(`broker error code=${parsed.code} message=${parsed.message}`);
          return;
        // Messages the runtime sends but doesn't receive from the broker:
        case "hello":
        case "ping":
        case "event":
        case "command_ack":
        case "relay_attach":
        case "relay_attached":
        case "relay_ready":
          this.options.warn(`unexpected message type from broker: ${parsed.type}`);
          return;
        default:
          assertNever(parsed);
      }
    });

    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
      }
      this.helloComplete = false;
      this.stopHeartbeat();
      this.options.onDisconnected();
      this.options.warn(
        `disconnected, reconnect in ${this.reconnectBackoffMs}ms`,
      );
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectBackoffMs);
      this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, 10_000);
    });

    ws.on("error", (error) => {
      if (this.socket !== ws) {
        return;
      }
      this.options.warn(
        `ws error: ${error instanceof Error ? error.message : "unknown"}`,
      );
    });
  }

  private enqueueForDelivery(message: OpenClawToBrokerMessage): void {
    this.outbox.enqueue(message);
    if (this.isReady()) {
      void this.flushOutbox();
    }
  }

  private isReady(): boolean {
    return (
      this.helloComplete &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  private sendRaw(message: OpenClawToBrokerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private async sendOverSocket(message: OpenClawToBrokerMessage): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.helloComplete) {
      throw new Error("Broker socket is not ready");
    }

    await new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async flushOutbox(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;

    try {
      while (this.isReady()) {
        const next = this.outbox.peek();
        if (!next) {
          break;
        }

        try {
          await this.sendOverSocket(next);
          this.outbox.shift();
        } catch {
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendImmediate({
        type: "ping",
        ts: Date.now(),
      });
    }, Math.max(1_000, intervalMs));
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
