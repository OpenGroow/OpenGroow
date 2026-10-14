import { PROTOCOL_VERSION } from "./status-types.js";
import type { Message } from "./wire-messages.js";
import {
  RUNTIME_NODES_PENDING_LIST,
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_CHECK,
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_NODES_CHECK_RESULT,
  RUNTIME_NODES_CLEANUP_STALE_RESULT,
} from "./runtime-nodes.js";
import {
  RUNTIME_WHATSAPP_PAIR_START,
  RUNTIME_WHATSAPP_PAIR_WAIT,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
} from "./runtime-whatsapp.js";
import {
  RUNTIME_TELEGRAM_CONFIG_SET,
  RUNTIME_TELEGRAM_CONFIG_SET_RESULT,
} from "./runtime-telegram.js";
import {
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
} from "./runtime-ai.js";
import { RUNTIME_HEALTH_CHECK, RUNTIME_HEALTH_RESULT } from "./runtime-health.js";
import {
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_CANCEL,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
} from "./runtime-openclaw-exec.js";
import {
  RUNTIME_AUTH_START,
  RUNTIME_AUTH_STATUS,
  RUNTIME_AUTH_INPUT,
  RUNTIME_AUTH_CANCEL,
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_ORDER_ACTIVATE,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AUTH_ACTIVATE_RESULT,
  RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
} from "./runtime-auth.js";
import {
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_FILE_DELETE,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
  RUNTIME_WORKSPACE_SKILL_FILES,
  RUNTIME_SKILLS_INSTALL_BATCH,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
} from "./runtime-workspace.js";
import {
  RUNTIME_MCP_SERVERS_MERGE,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
} from "./runtime-mcp.js";
import {
  RUNTIME_SESSION_TRANSCRIPT_READ,
  RUNTIME_SESSION_TRANSCRIPT_READ_RESULT,
} from "./runtime-session-transcript.js";
import {
  RUNTIME_AGENT_CREDENTIAL_SET,
  RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
} from "./runtime-agent-credential.js";
import { RUNTIME_PLUGINS_INSTALL, RUNTIME_PLUGINS_INSTALL_RESULT } from "./runtime-plugins.js";

/**
 * Emitted by the Runtime Worker's command router for a command type it has
 * no handler for. It is how a Convex deployment that is ahead of part of the
 * fleet detects that a newer compound command is unsupported and falls back
 * to the individual commands it replaces (issue #447).
 */
export const RUNTIME_COMMAND_UNSUPPORTED = "runtime.command.unsupported" as const;

export function buildRuntimeResultEventId(commandId: string): string {
  return `runtime-result:${commandId}`;
}

export type CodecFamily = "ws" | "admin_relay" | "runtime";

export type CodecIssue = {
  family: CodecFamily;
  type?: string;
  path: string;
};

/** A wire message failed structural validation. Values are deliberately not
 * included in the error so tokens, keys, and message bodies cannot leak into
 * logs. */
export class InvalidWireMessageError extends Error {
  constructor(public readonly issue: CodecIssue) {
    super(
      `Invalid ${issue.family} message${issue.type ? ` ${issue.type}` : ""} at ${issue.path}`,
    );
    this.name = "InvalidWireMessageError";
  }
}

export type ValidatedRuntimeResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: Record<string, unknown>;
};

export type ValidatedRuntimeResult = {
  type: string;
  payload: ValidatedRuntimeResultPayload;
};

const RUNTIME_COMMAND_TYPES = new Set<string>([
  RUNTIME_NODES_PENDING_LIST,
  RUNTIME_NODES_APPROVE,
  RUNTIME_NODES_CHECK,
  RUNTIME_WHATSAPP_PAIR_START,
  RUNTIME_WHATSAPP_PAIR_WAIT,
  RUNTIME_WHATSAPP_CONFIG_SET,
  RUNTIME_TELEGRAM_CONFIG_SET,
  RUNTIME_AI_CONFIG_SET,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET,
  RUNTIME_HEALTH_CHECK,
  RUNTIME_OPENCLAW_EXEC,
  RUNTIME_OPENCLAW_EXEC_CANCEL,
  RUNTIME_AUTH_START,
  RUNTIME_AUTH_STATUS,
  RUNTIME_AUTH_INPUT,
  RUNTIME_AUTH_CANCEL,
  RUNTIME_AUTH_ACTIVATE,
  RUNTIME_AUTH_ORDER_ACTIVATE,
  RUNTIME_WORKSPACE_LIST,
  RUNTIME_WORKSPACE_FILE_READ,
  RUNTIME_WORKSPACE_CREATE,
  RUNTIME_WORKSPACE_FILE_WRITE,
  RUNTIME_WORKSPACE_FILE_DELETE,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH,
  RUNTIME_SKILLS_INSTALL_BATCH,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE,
  RUNTIME_WORKSPACE_SKILL_FILES,
  RUNTIME_MCP_SERVERS_MERGE,
  RUNTIME_MCP_SERVERS_REMOVE,
  RUNTIME_SESSION_TRANSCRIPT_READ,
  RUNTIME_AGENT_CREDENTIAL_SET,
  RUNTIME_PLUGINS_INSTALL,
]);

const RUNTIME_RESULT_TYPES = new Set<string>([
  RUNTIME_NODES_PENDING_RESULT,
  RUNTIME_NODES_APPROVE_RESULT,
  RUNTIME_NODES_CHECK_RESULT,
  RUNTIME_NODES_CLEANUP_STALE_RESULT,
  RUNTIME_WHATSAPP_PAIR_START_RESULT,
  RUNTIME_WHATSAPP_PAIR_WAIT_RESULT,
  RUNTIME_WHATSAPP_CONFIG_SET_RESULT,
  RUNTIME_TELEGRAM_CONFIG_SET_RESULT,
  RUNTIME_AI_CONFIG_SET_RESULT,
  RUNTIME_SPEECH_TO_TEXT_CONFIG_SET_RESULT,
  RUNTIME_HEALTH_RESULT,
  RUNTIME_OPENCLAW_EXEC_RESULT,
  RUNTIME_OPENCLAW_EXEC_CANCEL_RESULT,
  RUNTIME_AUTH_START_RESULT,
  RUNTIME_AUTH_STATUS_RESULT,
  RUNTIME_AUTH_INPUT_RESULT,
  RUNTIME_AUTH_CANCEL_RESULT,
  RUNTIME_AUTH_ACTIVATE_RESULT,
  RUNTIME_AUTH_ORDER_ACTIVATE_RESULT,
  RUNTIME_WORKSPACE_LIST_RESULT,
  RUNTIME_WORKSPACE_FILE_READ_RESULT,
  RUNTIME_WORKSPACE_CREATE_RESULT,
  RUNTIME_WORKSPACE_FILE_WRITE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_RESULT,
  RUNTIME_WORKSPACE_FILE_DELETE_BATCH_RESULT,
  RUNTIME_SKILLS_INSTALL_BATCH_RESULT,
  RUNTIME_AGENT_REGISTER_AND_CONFIGURE_RESULT,
  RUNTIME_WORKSPACE_SKILL_FILES_RESULT,
  RUNTIME_MCP_SERVERS_MERGE_RESULT,
  RUNTIME_MCP_SERVERS_REMOVE_RESULT,
  RUNTIME_SESSION_TRANSCRIPT_READ_RESULT,
  RUNTIME_AGENT_CREDENTIAL_SET_RESULT,
  RUNTIME_PLUGINS_INSTALL_RESULT,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  issue: CodecIssue,
): string {
  if (typeof record[key] !== "string" || record[key] === "") {
    throw new InvalidWireMessageError({ ...issue, path: `${issue.path}.${key}` });
  }
  return record[key] as string;
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  issue: CodecIssue,
): number {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
    throw new InvalidWireMessageError({ ...issue, path: `${issue.path}.${key}` });
  }
  return record[key] as number;
}

function validateEnvelope(raw: unknown, family: CodecFamily): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new InvalidWireMessageError({ family, path: "$" });
  }
  if (typeof raw.type !== "string") {
    throw new InvalidWireMessageError({ family, path: "$.type" });
  }
  return raw;
}

/**
 * Strict replacement for `parse` at network seams. The historical parse is
 * intentionally left permissive for callers that still depend on it.
 *
 * Compile-time type vs. wire validation: `Message` (and the other union
 * types this package exports) describe the *shape data must have once it is
 * trusted* — they exist so the rest of the codebase gets autocomplete and
 * exhaustiveness checks, but TypeScript erases them at runtime and a
 * `value as Message` cast enforces nothing. Only `parseValidatedMessage` /
 * `parseRuntimeResult` actually inspect an `unknown` value's fields and
 * either return something that truly matches the type or throw
 * `InvalidWireMessageError`. Casting `unknown` (or a freshly-parsed JSON
 * blob) directly to `Message` anywhere outside this function reintroduces
 * the historical bug this codec was added to close.
 */
export function parseValidatedMessage(raw: unknown, family: CodecFamily = "ws"): Message {
  const envelope = validateEnvelope(raw, family);
  const messageType = envelope.type as string;
  const issue = { family, type: messageType, path: "$" } as const;

  switch (messageType) {
    case "hello":
      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        throw new InvalidWireMessageError({ ...issue, path: "$.protocolVersion" });
      }
      break;
    case "hello_ok":
      requireString(envelope, "instanceId", issue);
      requireNumber(envelope, "heartbeatIntervalMs", issue);
      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        throw new InvalidWireMessageError({ ...issue, path: "$.protocolVersion" });
      }
      break;
    case "ping":
    case "pong":
      requireNumber(envelope, "ts", issue);
      break;
    case "event":
      validateRuntimeEnvelope(envelope.event, family, "$.event");
      break;
    case "command":
      validateCommand(envelope.command, family, "$.command");
      break;
    case "command_ack":
      requireString(envelope, "commandId", issue);
      break;
    case "relay_attach":
      requireString(envelope, "sessionId", issue);
      requireString(envelope, "instanceId", issue);
      requireString(envelope, "path", issue);
      if (envelope.headers !== undefined) {
        if (!isRecord(envelope.headers) || !Object.values(envelope.headers).every((value) => typeof value === "string")) {
          throw new InvalidWireMessageError({ ...issue, path: "$.headers" });
        }
      }
      if (envelope.protocols !== undefined) {
        if (!Array.isArray(envelope.protocols) || !envelope.protocols.every((value) => typeof value === "string")) {
          throw new InvalidWireMessageError({ ...issue, path: "$.protocols" });
        }
      }
      break;
    case "relay_attached":
      requireString(envelope, "sessionId", issue);
      requireString(envelope, "instanceId", issue);
      break;
    case "relay_open":
      requireString(envelope, "sessionId", issue);
      requireString(envelope, "path", issue);
      break;
    case "relay_ready":
      requireString(envelope, "sessionId", issue);
      break;
    case "relay_data":
      requireString(envelope, "sessionId", issue);
      requireString(envelope, "data", issue);
      if (envelope.encoding !== "utf8" && envelope.encoding !== "base64") {
        throw new InvalidWireMessageError({ ...issue, path: "$.encoding" });
      }
      break;
    case "relay_close":
    case "relay_error":
      requireString(envelope, "sessionId", issue);
      if (messageType === "relay_error") requireString(envelope, "error", issue);
      break;
    case "error":
      requireString(envelope, "message", issue);
      if (envelope.code !== "UNAUTHORIZED" && envelope.code !== "BAD_MESSAGE") {
        throw new InvalidWireMessageError({ ...issue, path: "$.code" });
      }
      break;
    default:
      throw new InvalidWireMessageError({ ...issue, path: "$.type" });
  }
  // Every Message variant and its required fields have been checked above;
  // this is the single boundary where the validated record becomes Message.
  return envelope as unknown as Message;
}

function validateCommand(
  value: unknown,
  family: CodecFamily,
  path: string,
): void {
  const command = isRecord(value) ? value : null;
  const issue = { family, type: "command", path } as const;
  if (!command) throw new InvalidWireMessageError(issue);
  requireString(command, "id", issue);
  requireString(command, "type", issue);
  requireNumber(command, "ts", issue);
  if (!RUNTIME_COMMAND_TYPES.has(command.type as string)) {
    throw new InvalidWireMessageError({ ...issue, path: `${path}.type` });
  }
  if (command.payload !== undefined && !isRecord(command.payload)) {
    throw new InvalidWireMessageError({ ...issue, path: `${path}.payload` });
  }
}

function validateRuntimeEnvelope(
  value: unknown,
  family: CodecFamily,
  path: string,
): void {
  const event = isRecord(value) ? value : null;
  const issue = { family, type: "event", path } as const;
  if (!event) throw new InvalidWireMessageError(issue);
  requireString(event, "id", issue);
  requireString(event, "type", issue);
  requireNumber(event, "ts", issue);
  if (event.payload !== undefined && !isRecord(event.payload)) {
    throw new InvalidWireMessageError({ ...issue, path: `${path}.payload` });
  }
}

/** Validates a Runtime result payload after an Event has been decoded. */
export function parseRuntimeResult(
  type: string,
  payload: unknown,
): ValidatedRuntimeResultPayload {
  const issue = { family: "runtime" as const, type, path: "$.payload" };
  if (!RUNTIME_RESULT_TYPES.has(type)) {
    throw new InvalidWireMessageError({ ...issue, path: "$.type" });
  }
  const envelope = isRecord(payload) ? payload : null;
  if (!envelope) throw new InvalidWireMessageError(issue);
  const commandId = requireString(envelope, "commandId", issue);
  const instanceId = requireString(envelope, "instanceId", issue);
  if (typeof envelope.ok !== "boolean") {
    throw new InvalidWireMessageError({ ...issue, path: "$.payload.ok" });
  }
  if (envelope.error !== undefined && typeof envelope.error !== "string") {
    throw new InvalidWireMessageError({ ...issue, path: "$.payload.error" });
  }
  if (!isRecord(envelope.data)) {
    throw new InvalidWireMessageError({ ...issue, path: "$.payload.data" });
  }
  return {
    commandId,
    instanceId,
    ok: envelope.ok,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    data: envelope.data,
  };
}

/**
 * Encode a `Message` to a JSON string for wire transmission.
 */
export function encode(message: Message): string {
  return JSON.stringify(message);
}

/**
 * Exhaustiveness guard — assign a `never`-typed variable in the `default`
 * branch of a switch over `Message["type"]` to get a compile error when
 * a new union member is added but not handled.
 *
 * @example
 * switch (msg.type) {
 *   case "hello": ...
 *   default: assertNever(msg);
 * }
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify((value as Message).type)}`);
}
