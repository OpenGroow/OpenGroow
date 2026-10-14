import type { ProtocolVersion } from "./status-types.js";

export type Command = {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
};

export type Event = {
  id: string;
  type: string;
  payload?: unknown;
  ts: number;
};

export type CommandDispatchRequest = {
  instanceId: string;
  command: Command;
};

export type HelloMessage = {
  type: "hello";
  protocolVersion: ProtocolVersion;
};

export type HelloOkMessage = {
  type: "hello_ok";
  instanceId: string;
  heartbeatIntervalMs: number;
  protocolVersion: ProtocolVersion;
};

export type PingMessage = {
  type: "ping";
  ts: number;
};

export type PongMessage = {
  type: "pong";
  ts: number;
};

export type EventMessage = {
  type: "event";
  event: Event;
};

export type CommandMessage = {
  type: "command";
  command: Command;
};

export type CommandAckMessage = {
  type: "command_ack";
  commandId: string;
};

export type RelayAttachMessage = {
  type: "relay_attach";
  sessionId: string;
  instanceId: string;
  path: string;
  headers?: Record<string, string>;
  protocols?: string[];
};

export type RelayAttachedMessage = {
  type: "relay_attached";
  sessionId: string;
  instanceId: string;
};

export type RelayOpenMessage = {
  type: "relay_open";
  sessionId: string;
  path: string;
  headers?: Record<string, string>;
  protocols?: string[];
};

export type RelayReadyMessage = {
  type: "relay_ready";
  sessionId: string;
};

export type RelayDataMessage = {
  type: "relay_data";
  sessionId: string;
  encoding: "utf8" | "base64";
  data: string;
};

export type RelayCloseMessage = {
  type: "relay_close";
  sessionId: string;
  code?: number;
  reason?: string;
};

export type RelayErrorMessage = {
  type: "relay_error";
  sessionId: string;
  error: string;
};

export type ErrorMessage = {
  type: "error";
  code: "UNAUTHORIZED" | "BAD_MESSAGE";
  message: string;
};

export type OpenClawToBrokerMessage =
  | HelloMessage
  | PingMessage
  | PongMessage
  | EventMessage
  | CommandAckMessage
  | RelayReadyMessage
  | RelayDataMessage
  | RelayCloseMessage
  | RelayErrorMessage;

export type BrokerToOpenClawMessage =
  | HelloOkMessage
  | PongMessage
  | CommandMessage
  | ErrorMessage
  | RelayOpenMessage
  | RelayDataMessage
  | RelayCloseMessage
  | RelayErrorMessage;

export type AdminRelayToBrokerMessage =
  | RelayAttachMessage
  | RelayDataMessage
  | RelayCloseMessage;

export type BrokerToAdminRelayMessage =
  | RelayAttachedMessage
  | RelayReadyMessage
  | RelayDataMessage
  | RelayCloseMessage
  | RelayErrorMessage;

export type WsMessage = OpenClawToBrokerMessage | BrokerToOpenClawMessage;

/**
 * The full discriminated union of every message that can cross the wire.
 * Keyed by the `type` literal on each member.
 */
export type Message =
  | HelloMessage
  | HelloOkMessage
  | PingMessage
  | PongMessage
  | EventMessage
  | CommandMessage
  | CommandAckMessage
  | RelayAttachMessage
  | RelayAttachedMessage
  | RelayOpenMessage
  | RelayReadyMessage
  | RelayDataMessage
  | RelayCloseMessage
  | RelayErrorMessage
  | ErrorMessage;
