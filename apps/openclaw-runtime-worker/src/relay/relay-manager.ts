import WebSocket from "ws";
import type {
  RelayCloseMessage,
  RelayDataMessage,
  RelayOpenMessage,
} from "@opengroow/protocol";
import type { BrokerClient } from "../broker/broker-client.js";

export class RelayManager {
  private readonly relaySessions = new Map<string, WebSocket>();

  constructor(
    private readonly broker: BrokerClient,
    private readonly gatewayLocalPort: number,
  ) {}

  async handleRelayOpen(message: RelayOpenMessage): Promise<void> {
    const existing = this.relaySessions.get(message.sessionId);
    if (existing) {
      existing.close(1000, "Replacing relay session");
      this.relaySessions.delete(message.sessionId);
    }

    const relayUrl = new URL(
      message.path || "/",
      `ws://127.0.0.1:${this.gatewayLocalPort}`,
    );
    const protocols = Array.isArray(message.protocols)
      ? message.protocols.filter(Boolean)
      : [];
    const headers =
      message.headers && typeof message.headers === "object"
        ? Object.fromEntries(
            Object.entries(message.headers).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === "string" && typeof entry[1] === "string",
            ),
          )
        : undefined;

    const relaySocket = new WebSocket(
      relayUrl.toString(),
      protocols.length > 0 ? protocols : undefined,
      headers ? { headers } : undefined,
    );

    this.relaySessions.set(message.sessionId, relaySocket);

    relaySocket.on("open", () => {
      this.broker.sendImmediate({
        type: "relay_ready",
        sessionId: message.sessionId,
      });
    });

    relaySocket.on("message", (data, isBinary) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
        this.broker.sendImmediate({
          type: "relay_data",
          sessionId: message.sessionId,
          encoding: "base64",
          data: buffer.toString("base64"),
        });
        return;
      }

      this.broker.sendImmediate({
        type: "relay_data",
        sessionId: message.sessionId,
        encoding: "utf8",
        data: data.toString(),
      });
    });

    relaySocket.on("close", (code, reason) => {
      if (this.relaySessions.get(message.sessionId) === relaySocket) {
        this.relaySessions.delete(message.sessionId);
      }
      this.broker.sendImmediate({
        type: "relay_close",
        sessionId: message.sessionId,
        code,
        reason: reason.toString(),
      });
    });

    relaySocket.on("error", (error) => {
      this.broker.sendImmediate({
        type: "relay_error",
        sessionId: message.sessionId,
        error:
          error instanceof Error ? error.message : "Gateway relay socket failed",
      });
    });
  }

  handleRelayData(message: RelayDataMessage): void {
    const relaySocket = this.relaySessions.get(message.sessionId);
    if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
      this.broker.sendImmediate({
        type: "relay_error",
        sessionId: message.sessionId,
        error: "Local gateway relay session is not open",
      });
      return;
    }

    if (message.encoding === "base64") {
      relaySocket.send(Buffer.from(message.data, "base64"), { binary: true });
      return;
    }

    relaySocket.send(message.data);
  }

  handleRelayClose(message: RelayCloseMessage): void {
    this.closeRelaySession(message.sessionId, message.code, message.reason);
  }

  closeAllRelaySessions(): void {
    for (const sessionId of Array.from(this.relaySessions.keys())) {
      this.closeRelaySession(sessionId, 1011, "Broker connection closed");
    }
  }

  private closeRelaySession(
    sessionId: string,
    code?: number,
    reason?: string,
  ): void {
    const relaySocket = this.relaySessions.get(sessionId);
    if (!relaySocket) {
      return;
    }

    this.relaySessions.delete(sessionId);
    if (
      relaySocket.readyState === WebSocket.OPEN ||
      relaySocket.readyState === WebSocket.CONNECTING
    ) {
      relaySocket.close(code, reason);
    }
  }
}
