import { WebSocketServer, WebSocket } from "ws";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConvexHealthAdapter } from "./convex.js";
import {
  loadConvexKeys,
  loadOpenClawKeys,
  type ConvexKeyRegistry,
  type OpenClawKeyRegistry,
} from "./keys.js";
import { HmacVerifier } from "@opengroow/hmac";
import {
  parseValidatedMessage,
  assertNever,
  type AdminRelayToBrokerMessage,
  type BrokerToAdminRelayMessage,
  type RelayCloseMessage,
  type RelayDataMessage,
  type RelayErrorMessage,
  type RelayReadyMessage,
} from "@opengroow/protocol";

export type BrokerOptions = {
  port?: number;
  wsPath?: string;
  helloTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  hmacSkewMs?: number;
  nonceTtlMs?: number;
  log?: boolean;
  convex: ConvexHealthAdapter;
  openclawKeys?: OpenClawKeyRegistry;
  convexKeys?: ConvexKeyRegistry;
};

export type BrokerServer = {
  app: Hono;
  server: ReturnType<typeof serve>;
  wss: WebSocketServer;
  adminRelayWss: WebSocketServer;
  connections: Map<string, WebSocket>;
  port: number;
  close: () => Promise<void>;
};

type RelaySession = {
  sessionId: string;
  instanceId: string;
  adminWs: WebSocket;
  runtimeWs: WebSocket;
};

export function createBrokerServer(options: BrokerOptions): BrokerServer {
  const port = options.port ?? Number(process.env.BROKER_PORT ?? "4300");
  const wsPath = options.wsPath ?? (process.env.BROKER_WS_PATH ?? "/openclaw");
  const helloTimeoutMs =
    options.helloTimeoutMs ?? Number(process.env.BROKER_HELLO_TIMEOUT_MS ?? "5000");
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? Number(process.env.BROKER_HEARTBEAT_MS ?? "5000");
  const hmacSkewMs =
    options.hmacSkewMs ?? Number(process.env.BROKER_HMAC_MAX_SKEW_MS ?? "300000");
  const nonceTtlMs =
    options.nonceTtlMs ?? Number(process.env.BROKER_HMAC_NONCE_TTL_MS ?? "300000");
  const adminToken = process.env.BROKER_ADMIN_TOKEN ?? "";
  const adminRelayPath = process.env.BROKER_ADMIN_RELAY_PATH ?? "/broker/admin/relay";
  const openClawKeysFile = normalizeOptionalPath(process.env.BROKER_OPENCLAW_KEYS_FILE);

  const convex = options.convex;
  const openclawKeys = options.openclawKeys ?? loadOpenClawKeys();
  if (openClawKeysFile) {
    const persistedKeys = loadOpenClawKeysFromFile(openClawKeysFile);
    Object.assign(openclawKeys, persistedKeys);
  }
  const convexKeys = options.convexKeys ?? loadConvexKeys();
  const openClawVerifier = new HmacVerifier({
    keyRegistry: openclawKeys,
    prefix: "openclaw",
    skewMs: hmacSkewMs,
    nonceTtlMs,
  });
  const convexVerifier = new HmacVerifier({
    keyRegistry: convexKeys,
    prefix: "broker",
    skewMs: hmacSkewMs,
    nonceTtlMs,
  });

  const connections = new Map<string, WebSocket>();
  const socketMeta = new WeakMap<WebSocket, { instanceId: string; keyId: string }>();
  const relaySessions = new Map<string, RelaySession>();
  const relaySessionIdsByAdminWs = new WeakMap<WebSocket, Set<string>>();
  const relaySessionIdsByRuntimeWs = new WeakMap<WebSocket, Set<string>>();

  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      const health = await convex.health();
      return c.json(
        {
          status: 200,
          ok: true,
          service: "broker",
          connections: connections.size,
          convex: health
        },
        200
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to reach convex";
      return c.json({ status: 502, ok: false, service: "broker", error: message }, 502);
    }
  });

  app.post("/broker/commands", async (c) => {
    const rawBody = Buffer.from(await c.req.arrayBuffer());
    const auth = authenticateConvexRequest(c.req.raw, rawBody);
    if (!auth.ok) {
      return c.json({ status: 401, error: auth.error ?? "Unauthorized" }, 401);
    }

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return c.json({ status: 400, error: "Content-Type must be application/json" }, 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return c.json({ status: 400, error: "Invalid JSON body" }, 400);
    }

    if (!isRecord(parsed) || typeof parsed.instanceId !== "string" || parsed.instanceId === "") {
      return c.json({ status: 400, error: "Invalid command payload" }, 400);
    }
    let commandMessage: Extract<ReturnType<typeof parseValidatedMessage>, { type: "command" }>;
    try {
      commandMessage = parseValidatedMessage(
        { type: "command", command: parsed.command },
        "runtime",
      ) as Extract<ReturnType<typeof parseValidatedMessage>, { type: "command" }>;
    } catch {
      return c.json({ status: 400, error: "Invalid command payload" }, 400);
    }

    const ws = connections.get(parsed.instanceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return c.json({ status: 409, error: "OpenClaw offline" }, 409);
    }

    if (options.log !== false) {
      console.log(
        `[broker] dispatch command instanceId=${parsed.instanceId} commandId=${commandMessage.command.id} type=${commandMessage.command.type}`
      );
    }
    sendJson(ws, commandMessage);
    return c.json({ status: 200, ok: true }, 200);
  });

  app.post("/broker/commands/batch", async (c) => {
    const rawBody = Buffer.from(await c.req.arrayBuffer());
    const auth = authenticateConvexRequest(c.req.raw, rawBody);
    if (!auth.ok) {
      return c.json({ status: 401, error: auth.error ?? "Unauthorized" }, 401);
    }

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return c.json({ status: 400, error: "Content-Type must be application/json" }, 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return c.json({ status: 400, error: "Invalid JSON body" }, 400);
    }

    if (!isRecord(parsed) || typeof parsed.instanceId !== "string" || parsed.instanceId === "") {
      return c.json({ status: 400, error: "Invalid batch payload" }, 400);
    }
    if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
      return c.json({ status: 400, error: "commands must be a non-empty array" }, 400);
    }

    const ws = connections.get(parsed.instanceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return c.json({ status: 409, error: "OpenClaw offline" }, 409);
    }

    let forwarded = 0;
    const failed: string[] = [];
    for (const rawCommand of parsed.commands) {
      try {
        const commandMessage = parseValidatedMessage(
          { type: "command", command: rawCommand },
          "runtime",
        ) as Extract<ReturnType<typeof parseValidatedMessage>, { type: "command" }>;
        if (options.log !== false) {
          console.log(
            `[broker] dispatch batch command instanceId=${parsed.instanceId} commandId=${commandMessage.command.id} type=${commandMessage.command.type}`
          );
        }
        sendJson(ws, commandMessage);
        forwarded++;
      } catch {
        const skippedId = isRecord(rawCommand) && typeof rawCommand.id === "string" ? rawCommand.id : "unknown";
        failed.push(skippedId);
        console.warn(`[broker] skipping invalid command ${skippedId} in batch for ${parsed.instanceId}`);
      }
    }

    if (failed.length > 0) {
      return c.json({ status: 207, ok: false, forwarded, failed }, 207);
    }
    return c.json({ status: 200, ok: true, forwarded }, 200);
  });

  app.post("/broker/admin/openclaw-keys/upsert", async (c) => {
    if (!adminToken) {
      return c.json({ status: 503, error: "BROKER_ADMIN_TOKEN not configured" }, 503);
    }
    const authorization = c.req.header("authorization") ?? "";
    if (authorization !== `Bearer ${adminToken}`) {
      return c.json({ status: 401, error: "Unauthorized" }, 401);
    }

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return c.json({ status: 400, error: "Content-Type must be application/json" }, 400);
    }

    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json({ status: 400, error: "Invalid JSON body" }, 400);
    }
    if (!isRecord(parsed)) {
      return c.json({ status: 400, error: "Invalid payload" }, 400);
    }
    const keyId = parsed.keyId;
    const openClawId = parsed.openClawId;
    const secret = parsed.secret;
    if (typeof keyId !== "string" || typeof openClawId !== "string" || typeof secret !== "string") {
      return c.json({ status: 400, error: "keyId/openClawId/secret are required" }, 400);
    }

    openclawKeys[keyId] = { openClawId, secret };
    if (openClawKeysFile) {
      try {
        persistOpenClawKeys(openClawKeysFile, openclawKeys);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to persist openclaw keys";
        return c.json({ status: 500, error: message }, 500);
      }
    }
    if (options.log !== false) {
      console.log(`[broker] upsert openclaw key keyId=${keyId} instanceId=${openClawId}`);
    }
    return c.json({ status: 200, ok: true }, 200);
  });

  app.notFound((c) => {
    return c.json({ status: 404, error: "Not found" }, 404);
  });

  const wss = new WebSocketServer({ noServer: true });
  const adminRelayWss = new WebSocketServer({ noServer: true });

  const server = serve({ fetch: app.fetch, port }, () => {
    if (options.log !== false) {
      console.log(`[broker] listening on http://localhost:${port}`);
      console.log(`[broker] ws path: ${wsPath}`);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    // Malformed Host/URL headers make `new URL()` throw synchronously; since
    // this fires from Node's http server internals, an uncaught throw here
    // takes down the whole process.
    let url: URL;
    try {
      const host = req.headers.host ?? "localhost";
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname === wsPath) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    if (url.pathname === adminRelayPath) {
      if (!adminToken) {
        socket.destroy();
        return;
      }
      const authorization = req.headers.authorization ?? "";
      if (authorization !== `Bearer ${adminToken}`) {
        socket.destroy();
        return;
      }
      adminRelayWss.handleUpgrade(req, socket, head, (ws) => {
        adminRelayWss.emit("connection", ws, req);
      });
      return;
    }
    socket.destroy();
  });

  adminRelayWss.on("connection", (ws) => {
    let attachedSessionId: string | null = null;

    ws.on("message", (data) => {
      let parsed: ReturnType<typeof parseValidatedMessage>;
      try {
        const raw: unknown = JSON.parse(data.toString("utf8"));
        parsed = parseValidatedMessage(raw, "admin_relay");
      } catch (error) {
        ws.close(1008, error instanceof SyntaxError ? "Invalid JSON" : "Unsupported relay message");
        return;
      }

      if (!attachedSessionId) {
        if (parsed.type !== "relay_attach") {
          ws.close(1008, "Expected relay_attach");
          return;
        }
        const attach = parsed;
        const runtimeWs = connections.get(attach.instanceId);
        if (!runtimeWs || runtimeWs.readyState !== WebSocket.OPEN) {
          sendAdminRelayMessage(ws, {
            type: "relay_error",
            sessionId: attach.sessionId,
            error: "OpenClaw offline"
          });
          ws.close(1013, "OpenClaw offline");
          return;
        }

        cleanupRelaySession(attach.sessionId);
        relaySessions.set(attach.sessionId, {
          sessionId: attach.sessionId,
          instanceId: attach.instanceId,
          adminWs: ws,
          runtimeWs
        });
        indexRelaySession(relaySessionIdsByAdminWs, ws, attach.sessionId);
        indexRelaySession(relaySessionIdsByRuntimeWs, runtimeWs, attach.sessionId);
        attachedSessionId = attach.sessionId;
        sendAdminRelayMessage(ws, {
          type: "relay_attached",
          sessionId: attach.sessionId,
          instanceId: attach.instanceId
        });
        sendJson(runtimeWs, {
          type: "relay_open",
          sessionId: attach.sessionId,
          path: attach.path,
          headers: attach.headers,
          protocols: attach.protocols
        });
        return;
      }

      // Exhaustive switch over all Message members
      switch (parsed.type) {
        case "relay_data":
        case "relay_close": {
          if (parsed.sessionId !== attachedSessionId) {
            ws.close(1008, "Invalid sessionId");
            return;
          }
          const session = relaySessions.get(attachedSessionId);
          if (!session || session.adminWs !== ws || session.runtimeWs.readyState !== WebSocket.OPEN) {
            sendAdminRelayMessage(ws, {
              type: "relay_error",
              sessionId: attachedSessionId,
              error: "Relay session is no longer active"
            });
            ws.close(1011, "Relay session inactive");
            return;
          }
          sendJson(session.runtimeWs, parsed);
          if (parsed.type === "relay_close") {
            cleanupRelaySession(attachedSessionId, { notifyRuntime: false });
          }
          return;
        }
        // Only relay_data and relay_close are valid post-attach; everything else is unsupported
        case "relay_attach":
        case "hello":
        case "hello_ok":
        case "ping":
        case "pong":
        case "event":
        case "command":
        case "command_ack":
        case "relay_attached":
        case "relay_open":
        case "relay_ready":
        case "relay_error":
        case "error":
          ws.close(1008, "Unsupported relay message");
          return;
        default:
          assertNever(parsed);
      }
    });

    ws.on("close", () => {
      cleanupRelaySessionsForAdminWs(ws);
    });

    ws.on("error", (error) => {
      console.warn("[broker] admin relay ws error", error);
    });
  });

  wss.on("connection", (ws, req) => {
    const auth = authenticateOpenClaw(req);
    if (!auth.ok || !auth.instanceId || !auth.keyId) {
      ws.close(1008, auth.error ?? "Unauthorized");
      return;
    }

    let helloReceived = false;
    const helloTimeout = setTimeout(() => {
      if (!helloReceived) {
        ws.close(1008, "hello timeout");
      }
    }, helloTimeoutMs);

    const instanceId = auth.instanceId;
    const keyId = auth.keyId;

    ws.on("message", async (data) => {
      let parsed: ReturnType<typeof parseValidatedMessage>;
      try {
        const raw: unknown = JSON.parse(data.toString());
        parsed = parseValidatedMessage(raw, "runtime");
      } catch (error) {
        sendJson(ws, {
          type: "error",
          code: "BAD_MESSAGE",
          message: error instanceof SyntaxError ? "Invalid JSON" : "Invalid message",
        });
        return;
      }

      if (!helloReceived) {
        if (parsed.type !== "hello") {
          ws.close(1008, "Expected hello");
          return;
        }
        if (parsed.protocolVersion !== 1) {
          ws.close(1008, "Unsupported protocol");
          return;
        }
        helloReceived = true;
        clearTimeout(helloTimeout);
        const existing = connections.get(instanceId);
        if (existing && existing !== ws) {
          existing.close(4000, "Replaced by new connection");
        }
        connections.set(instanceId, ws);
        socketMeta.set(ws, { instanceId, keyId });
        sendJson(ws, {
          type: "hello_ok",
          instanceId,
          heartbeatIntervalMs,
          protocolVersion: 1
        });
        if (options.log !== false) {
          console.log(`[broker] OpenClaw connected ${instanceId}`);
        }
        return;
      }

      // Exhaustive switch over OpenClawToBrokerMessage members
      // (broker receives these from the runtime side)
      switch (parsed.type) {
        case "hello":
          // duplicate hello after handshake — ignore
          return;
        case "ping":
          sendJson(ws, { type: "pong", ts: parsed.ts ?? Date.now() });
          return;
        case "pong":
          return;
        case "event":
          try {
            await convex.ingestEvent(instanceId, parsed.event);
          } catch (error) {
            console.warn(`[broker] failed to ingest event for ${instanceId}`, error);
          }
          return;
        case "command_ack": {
          const commandId = parsed.commandId;
          if (typeof commandId !== "string") {
            sendJson(ws, { type: "error", code: "BAD_MESSAGE", message: "Invalid command_ack" });
            return;
          }
          if (options.log !== false) {
            console.log(`[broker] command ack instanceId=${instanceId} commandId=${commandId}`);
          }
          try {
            await convex.ackCommand(instanceId, commandId);
          } catch (error) {
            console.warn(`[broker] failed to ack command for ${instanceId}`, error);
          }
          return;
        }
        case "relay_ready":
          handleRuntimeRelayReady(ws, instanceId, parsed);
          return;
        case "relay_data":
          handleRuntimeRelayData(ws, instanceId, parsed);
          return;
        case "relay_close":
          handleRuntimeRelayClose(ws, instanceId, parsed);
          return;
        case "relay_error":
          handleRuntimeRelayError(ws, instanceId, parsed);
          return;
        // Messages the broker sends but does not receive from the runtime:
        case "hello_ok":
        case "command":
        case "relay_attach":
        case "relay_attached":
        case "relay_open":
        case "error":
          sendJson(ws, { type: "error", code: "BAD_MESSAGE", message: "Unexpected message type" });
          return;
        default:
          assertNever(parsed);
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimeout);
      cleanupRelaySessionsForRuntimeWs(ws, `OpenClaw disconnected ${instanceId}`);
      // Only clear the registry entry if it's still this socket — the
      // hello-handshake path above (`existing.close(...)`) replaces a stale
      // connection with a new one *before* the old one's own "close" fires,
      // so an unconditional delete here would race and evict the brand-new,
      // still-live connection instead of the one that actually closed.
      if (connections.get(instanceId) === ws) {
        connections.delete(instanceId);
        if (options.log !== false) {
          console.log(`[broker] OpenClaw disconnected ${instanceId}`);
        }
      }
    });

    ws.on("error", (error) => {
      console.warn(`[broker] ws error for ${instanceId}`, error);
    });
  });

  function authenticateOpenClaw(req: import("node:http").IncomingMessage): {
    ok: boolean;
    instanceId?: string;
    keyId?: string;
    error?: string;
  } {
    const result = openClawVerifier.verify({
      headers: req.headers as Record<string, string | string[] | undefined>,
      method: "GET",
      path: wsPath,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const record = openclawKeys[result.keyId];
    return { ok: true, instanceId: record.openClawId, keyId: result.keyId };
  }

  function authenticateConvexRequest(
    req: Request,
    rawBody: Buffer
  ): { ok: boolean; keyId?: string; error?: string } {
    const path = new URL(req.url).pathname;
    const result = convexVerifier.verify({
      headers: req.headers,
      method: req.method,
      path,
      body: rawBody,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, keyId: result.keyId };
  }

  const address = server.address() as AddressInfo;
  const actualPort = address?.port ?? port;

  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      wss.close();
      adminRelayWss.close();
    });

  return {
    app,
    server,
    wss,
    adminRelayWss,
    connections,
    port: actualPort,
    close
  };

  function handleRuntimeRelayReady(
    runtimeWs: WebSocket,
    instanceId: string,
    message: RelayReadyMessage
  ): void {
    const session = relaySessions.get(message.sessionId);
    if (!session || session.runtimeWs !== runtimeWs || session.instanceId !== instanceId) {
      sendJson(runtimeWs, {
        type: "relay_error",
        sessionId: message.sessionId,
        error: "Unknown relay session"
      });
      return;
    }
    sendAdminRelayMessage(session.adminWs, message);
  }

  function handleRuntimeRelayData(
    runtimeWs: WebSocket,
    instanceId: string,
    message: RelayDataMessage
  ): void {
    const session = relaySessions.get(message.sessionId);
    if (!session || session.runtimeWs !== runtimeWs || session.instanceId !== instanceId) {
      sendJson(runtimeWs, {
        type: "relay_error",
        sessionId: message.sessionId,
        error: "Unknown relay session"
      });
      return;
    }
    sendAdminRelayMessage(session.adminWs, message);
  }

  function handleRuntimeRelayClose(
    runtimeWs: WebSocket,
    instanceId: string,
    message: RelayCloseMessage
  ): void {
    const session = relaySessions.get(message.sessionId);
    if (!session || session.runtimeWs !== runtimeWs || session.instanceId !== instanceId) {
      return;
    }
    sendAdminRelayMessage(session.adminWs, message);
    cleanupRelaySession(message.sessionId, { notifyAdmin: false, notifyRuntime: false });
  }

  function handleRuntimeRelayError(
    runtimeWs: WebSocket,
    instanceId: string,
    message: RelayErrorMessage
  ): void {
    const session = relaySessions.get(message.sessionId);
    if (!session || session.runtimeWs !== runtimeWs || session.instanceId !== instanceId) {
      return;
    }
    sendAdminRelayMessage(session.adminWs, message);
    cleanupRelaySession(message.sessionId, { notifyAdmin: false, notifyRuntime: false });
  }

  function cleanupRelaySessionsForAdminWs(adminWs: WebSocket): void {
    const sessionIds = relaySessionIdsByAdminWs.get(adminWs);
    if (!sessionIds || sessionIds.size === 0) {
      return;
    }
    for (const sessionId of Array.from(sessionIds)) {
      cleanupRelaySession(sessionId, { notifyRuntime: true });
    }
  }

  function cleanupRelaySessionsForRuntimeWs(runtimeWs: WebSocket, reason: string): void {
    const sessionIds = relaySessionIdsByRuntimeWs.get(runtimeWs);
    if (!sessionIds || sessionIds.size === 0) {
      return;
    }
    for (const sessionId of Array.from(sessionIds)) {
      cleanupRelaySession(sessionId, { notifyAdmin: true, notifyRuntime: false, reason });
    }
  }

  function cleanupRelaySession(
    sessionId: string,
    options: {
      notifyAdmin?: boolean;
      notifyRuntime?: boolean;
      code?: number;
      reason?: string;
    } = {}
  ): void {
    const session = relaySessions.get(sessionId);
    if (!session) {
      return;
    }
    relaySessions.delete(sessionId);
    unindexRelaySession(relaySessionIdsByAdminWs, session.adminWs, sessionId);
    unindexRelaySession(relaySessionIdsByRuntimeWs, session.runtimeWs, sessionId);

    if (options.notifyAdmin) {
      sendAdminRelayMessage(session.adminWs, {
        type: "relay_close",
        sessionId,
        code: options.code ?? 1011,
        reason: options.reason
      });
    }
    if (options.notifyRuntime) {
      sendJson(session.runtimeWs, {
        type: "relay_close",
        sessionId,
        code: options.code ?? 1000,
        reason: options.reason
      });
    }
  }
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendAdminRelayMessage(ws: WebSocket, payload: BrokerToAdminRelayMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexRelaySession(
  index: WeakMap<WebSocket, Set<string>>,
  ws: WebSocket,
  sessionId: string
): void {
  const sessionIds = index.get(ws) ?? new Set<string>();
  sessionIds.add(sessionId);
  index.set(ws, sessionIds);
}

function unindexRelaySession(
  index: WeakMap<WebSocket, Set<string>>,
  ws: WebSocket,
  sessionId: string
): void {
  const sessionIds = index.get(ws);
  if (!sessionIds) {
    return;
  }
  sessionIds.delete(sessionId);
  if (sessionIds.size === 0) {
    index.delete(ws);
  }
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

function loadOpenClawKeysFromFile(path: string): OpenClawKeyRegistry {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Invalid BROKER_OPENCLAW_KEYS_FILE JSON (${path}): ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid BROKER_OPENCLAW_KEYS_FILE payload (${path}): expected object`);
  }
  const output: OpenClawKeyRegistry = {};
  for (const [keyId, value] of Object.entries(parsed)) {
    if (!isRecord(value) || typeof value.openClawId !== "string" || typeof value.secret !== "string") {
      throw new Error(`Invalid BROKER_OPENCLAW_KEYS_FILE record for keyId=${keyId}`);
    }
    const resources =
      Array.isArray(value.resources) && value.resources.every((item) => typeof item === "string")
        ? value.resources
        : undefined;
    output[keyId] = {
      openClawId: value.openClawId,
      secret: value.secret,
      resources
    };
  }
  return output;
}

function persistOpenClawKeys(path: string, keys: OpenClawKeyRegistry): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(keys)}\n`, "utf8");
  renameSync(tmpPath, path);
}
