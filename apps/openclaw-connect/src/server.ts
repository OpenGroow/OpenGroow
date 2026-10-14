import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import {
  createConnectSessionStore,
  type ConnectSessionPhase,
} from "./connect-session-store.js";
import { loadOpenClawConnectEnvFile } from "./env.js";
import {
  isPairingRequiredCloseReason,
  normalizeWebSocketCloseCode,
  parseRawProtocols,
  truncateCloseReason,
} from "./ws-utils.js";

loadOpenClawConnectEnvFile();

const PORT = Number(process.env.PORT ?? "4700");
const BROKER_ADMIN_URL = process.env.BROKER_ADMIN_URL?.trim() ?? "";
const BROKER_ADMIN_TOKEN = process.env.BROKER_ADMIN_TOKEN?.trim() ?? "";
const CONVEX_URL =
  process.env.CONVEX_URL?.trim() ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ??
  "http://127.0.0.1:3210";
const CONVEX_TOKEN = process.env.CONVEX_TOKEN?.trim() ?? "";
const CONVEX_SKIP_URL_CHECK = process.env.CONVEX_SKIP_URL_CHECK === "1";

const internal = anyApi;
// getActiveByTicketId is an internal query, but openclaw-connect is a backend
// service authenticated with an admin token. At runtime it can call internal
// functions. This cast is an acknowledged edge case.
const getTicketQuery = internal.connect_tickets.getActiveByTicketId as FunctionReference<"query">;

type ConnectTicketRecord = {
  ticketId: string;
  instanceId: string;
  gatewayToken: string;
  openclawName?: string;
  ipv4?: string;
  serverId?: number;
  createdAt: number;
  expiresAt: number;
};

type PublicConnectSessionStatus = {
  ticketId: string;
  phase: ConnectSessionPhase;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  connectedAt?: string;
  error?: string;
};

type RelayConnectContext = {
  brokerRelayUrl: string;
  gatewayPath: string;
  requestedProtocols: string[];
  ticket?: ConnectTicketRecord;
  allowLateConnectAuth?: boolean;
};

type RelayUpgradeRequest = {
  ticketId: string;
  gatewayPath: string;
  via: "path" | "authorization";
};

type RelayFrame = {
  type: "relay_data";
  sessionId: string;
  encoding: "utf8" | "base64";
  data: string;
};

type RelayBrokerMessage =
  | {
      type: "relay_attached";
      sessionId: string;
      instanceId: string;
    }
  | {
      type: "relay_ready";
      sessionId: string;
    }
  | RelayFrame
  | {
      type: "relay_close";
      sessionId: string;
      code?: number;
      reason?: string;
    }
  | {
      type: "relay_error";
      sessionId: string;
      error: string;
    };

const convexClient = createConvexClient();
const connectRelayWss = new WebSocketServer({ noServer: true });
const connectSessionStore = createConnectSessionStore();
const app = new Hono();

app.get("/health", (c) => {
  return c.json(
    {
      status: 200,
      ok: true,
      service: "@opengroow/openclaw-connect",
      brokerConfigured: BROKER_ADMIN_URL.length > 0 && BROKER_ADMIN_TOKEN.length > 0,
      convexConfigured: CONVEX_URL.length > 0,
      convexAuthConfigured: CONVEX_TOKEN.length > 0
    },
    200
  );
});

app.get("/connect/:ticketId/status", async (c) => {
  let ticket: ConnectTicketRecord | null = null;
  try {
    ticket = await getActiveTicket(c.req.param("ticketId"));
  } catch (error) {
    console.error("[openclaw-connect] failed to resolve connect ticket", error);
    return c.json({ status: 500, error: "Failed to resolve connect ticket" }, 500);
  }
  if (!ticket) {
    return c.json({ status: 404, error: "Connect ticket not found or expired" }, 404);
  }

  const session = connectSessionStore.get(ticket);
  return c.json(
    {
      status: 200,
      ok: true,
      session: toPublicConnectSessionStatus(session),
    },
    200,
  );
});

app.get("/connect/:ticketId", async (c) => {
  let ticket: ConnectTicketRecord | null = null;
  try {
    ticket = await getActiveTicket(c.req.param("ticketId"));
  } catch (error) {
    console.error("[openclaw-connect] failed to resolve connect ticket", error);
    return c.json({ status: 500, error: "Failed to resolve connect ticket" }, 500);
  }
  if (!ticket) {
    return c.json({ status: 404, error: "Connect ticket not found or expired" }, 404);
  }
  return c.json(
    {
      status: 200,
      ok: true,
      ticket: {
        id: ticket.ticketId,
        instanceId: ticket.instanceId,
        openclawName: ticket.openclawName,
        ipv4: ticket.ipv4,
        serverId: ticket.serverId,
        createdAt: new Date(ticket.createdAt).toISOString(),
        expiresAt: new Date(ticket.expiresAt).toISOString()
      }
    },
    200
  );
});

app.all("/connect/:ticketId/gateway", async (c) => {
  let ticket: ConnectTicketRecord | null = null;
  try {
    ticket = await getActiveTicket(c.req.param("ticketId"));
  } catch (error) {
    console.error("[openclaw-connect] failed to resolve connect ticket", error);
    return c.json({ status: 500, error: "Failed to resolve connect ticket" }, 500);
  }
  if (!ticket) {
    return c.json({ status: 404, error: "Connect ticket not found or expired" }, 404);
  }
  return c.json(
    {
      status: 426,
      error: "Gateway relay is WebSocket-only in this MVP. Connect with WebSocket to this URL.",
      ticket: {
        id: ticket.ticketId,
        instanceId: ticket.instanceId,
        openclawName: ticket.openclawName,
        expiresAt: new Date(ticket.expiresAt).toISOString()
      }
    },
    426
  );
});

app.all("/connect/:ticketId/gateway/*", async (c) => {
  let ticket: ConnectTicketRecord | null = null;
  try {
    ticket = await getActiveTicket(c.req.param("ticketId"));
  } catch (error) {
    console.error("[openclaw-connect] failed to resolve connect ticket", error);
    return c.json({ status: 500, error: "Failed to resolve connect ticket" }, 500);
  }
  if (!ticket) {
    return c.json({ status: 404, error: "Connect ticket not found or expired" }, 404);
  }
  return c.json(
    {
      status: 426,
      error: "Gateway relay is WebSocket-only in this MVP. Connect with WebSocket to this URL.",
      ticket: {
        id: ticket.ticketId,
        instanceId: ticket.instanceId,
        openclawName: ticket.openclawName,
        expiresAt: new Date(ticket.expiresAt).toISOString()
      }
    },
    426
  );
});

app.notFound((c) => c.json({ status: 404, error: "Not found" }, 404));

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[openclaw-connect] listening on http://localhost:${PORT}`);
});

server.on("upgrade", async (req, socket, head) => {
  try {
    const relayRequest = resolvePublicRelayUpgradeRequest(req);
    const allowLateConnectAuth = !relayRequest && isAnonymousRootUpgradeRequest(req);
    if (!relayRequest && !allowLateConnectAuth) {
      socket.destroy();
      return;
    }

    const brokerRelayUrl = buildBrokerRelayWebSocketUrl();
    if (!brokerRelayUrl) {
      writeUpgradeError(socket, 503, "Broker relay is not configured");
      return;
    }

    let relayContext: RelayConnectContext;
    if (relayRequest) {
      const ticket = await getActiveTicket(relayRequest.ticketId);
      if (!ticket) {
        writeUpgradeError(
          socket,
          relayRequest.via === "authorization" ? 401 : 404,
          relayRequest.via === "authorization"
            ? "Invalid or expired connect token"
            : "Connect ticket not found or expired"
        );
        return;
      }

      relayContext = {
        ticket,
        brokerRelayUrl,
        gatewayPath: relayRequest.gatewayPath,
        requestedProtocols: parseRequestedProtocols(req)
      };
    } else {
      relayContext = {
        brokerRelayUrl,
        gatewayPath: "/",
        requestedProtocols: parseRequestedProtocols(req),
        allowLateConnectAuth: true
      };
    }

    connectRelayWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      connectRelayWss.emit("connection", ws, req, relayContext);
    });
  } catch (error) {
    console.error("[openclaw-connect] websocket upgrade failed", error);
    writeUpgradeError(socket, 500, "Connect relay upgrade failed");
  }
});

connectRelayWss.on(
  "connection",
  (clientWs: WebSocket, _req: IncomingMessage, context: RelayConnectContext) => {
    const sessionId = randomUUID();
    const pendingFrames: RelayFrame[] = [];
    let brokerWs: WebSocket | null = null;
    let relayReady = false;
    let clientClosed = false;
    let brokerClosed = false;
    let resolvedTicket: ConnectTicketRecord | null = context.ticket ?? null;
    let resolvingLateAuth = false;
    let revalidateInterval: ReturnType<typeof setInterval> | null = null;
    const lateAuthTimer =
      context.allowLateConnectAuth === true
        ? setTimeout(() => {
            closeClient(1008, "Connect ticket required");
          }, 5000)
        : null;

    const flushPendingFrames = () => {
      if (!relayReady || !brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
        return;
      }
      while (pendingFrames.length > 0) {
        const frame = pendingFrames.shift();
        if (!frame) {
          break;
        }
        brokerWs.send(JSON.stringify(frame));
      }
    };

    const closeClient = (code: number, reason: string) => {
      if (clientClosed) {
        return;
      }
      clientClosed = true;
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        clientWs.close(code, truncateCloseReason(reason));
      }
    };

    const closeBroker = () => {
      if (brokerClosed) {
        return;
      }
      brokerClosed = true;
      if (
        brokerWs &&
        (brokerWs.readyState === WebSocket.OPEN || brokerWs.readyState === WebSocket.CONNECTING)
      ) {
        brokerWs.close();
      }
    };

    const startBrokerRelay = (ticket: ConnectTicketRecord) => {
      resolvedTicket = ticket;
      connectSessionStore.get(ticket);
      const ws = new WebSocket(context.brokerRelayUrl, {
        headers: {
          authorization: `Bearer ${BROKER_ADMIN_TOKEN}`
        }
      });
      brokerWs = ws;

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "relay_attach",
            sessionId,
            instanceId: ticket.instanceId,
            path: context.gatewayPath,
            headers: {
              authorization: `Bearer ${ticket.gatewayToken}`,
              "x-openclaw-token": ticket.gatewayToken
            },
            protocols: context.requestedProtocols
          })
        );
      });

      ws.on("message", (data: WebSocket.RawData) => {
        let parsed: RelayBrokerMessage | null = null;
        try {
          parsed = JSON.parse(data.toString()) as RelayBrokerMessage;
        } catch {
          closeClient(1011, "Invalid relay response");
          closeBroker();
          return;
        }

        if (!parsed || parsed.sessionId !== sessionId) {
          return;
        }

        if (parsed.type === "relay_attached") {
          return;
        }

        if (parsed.type === "relay_ready") {
          relayReady = true;
          connectSessionStore.beginStableConnect(ticket);
          flushPendingFrames();
          return;
        }

        if (parsed.type === "relay_data") {
          if (clientWs.readyState !== WebSocket.OPEN) {
            return;
          }
          if (parsed.encoding === "base64") {
            clientWs.send(Buffer.from(parsed.data, "base64"), { binary: true });
            return;
          }
          clientWs.send(parsed.data);
          return;
        }

        if (parsed.type === "relay_error") {
          connectSessionStore.setPhase(ticket, "failed", {
            error: parsed.error || "Relay error",
          });
          closeClient(1011, parsed.error || "Relay error");
          closeBroker();
          return;
        }

        if (parsed.type === "relay_close") {
          connectSessionStore.cancelStableConnect(ticket.ticketId);
          if (isPairingRequiredClose(parsed.code, parsed.reason)) {
            connectSessionStore.setPhase(ticket, "approval_required");
          } else if (
            parsed.code !== 1000 &&
            connectSessionStore.get(ticket).phase !== "connected"
          ) {
            connectSessionStore.setPhase(ticket, "failed", {
              error: parsed.reason || `Relay closed (${parsed.code ?? "unknown"})`,
            });
          }
          closeClient(
            normalizeWebSocketCloseCode(parsed.code),
            parsed.reason || "Relay closed",
          );
          closeBroker();
        }
      });

      ws.on("close", () => {
        brokerClosed = true;
        if (revalidateInterval) { clearInterval(revalidateInterval); revalidateInterval = null; }
        connectSessionStore.cancelStableConnect(ticket.ticketId);
        closeClient(1011, "Gateway relay disconnected");
      });

      ws.on("error", (error: Error) => {
        console.warn("[openclaw-connect] broker relay ws error", error);
        connectSessionStore.cancelStableConnect(ticket.ticketId);
        connectSessionStore.setPhase(ticket, "failed", {
          error: error.message || "Broker relay failed",
        });
        closeClient(1011, error.message || "Broker relay failed");
      });

      revalidateInterval = setInterval(() => {
        void getActiveTicket(ticket.ticketId).then((still) => {
          if (!still) closeClient(1008, "Connect ticket expired");
        }).catch(() => {
          // query failure — on garde la connexion ouverte
        });
      }, 30_000);
    };

    if (resolvedTicket) {
      startBrokerRelay(resolvedTicket);
    }

    clientWs.on("message", async (data: WebSocket.RawData, isBinary: boolean) => {
      let frameData: WebSocket.RawData | string = data;
      if (!isBinary) {
        const raw = data.toString();
        if (!resolvedTicket && context.allowLateConnectAuth === true) {
          if (resolvingLateAuth) {
            return;
          }
        const ticketId = extractConnectTicketId(raw);
        if (!ticketId) {
          closeClient(1008, "Connect ticket required");
          return;
        }
        resolvingLateAuth = true;
          let ticket: ConnectTicketRecord | null = null;
          try {
            ticket = await getActiveTicket(ticketId);
          } catch (error) {
            console.error("[openclaw-connect] late connect ticket lookup failed", error);
            resolvingLateAuth = false;
            closeClient(1011, "Connect ticket lookup failed");
            return;
          }
          resolvingLateAuth = false;
          if (!ticket) {
            closeClient(1008, "Invalid or expired connect token");
            return;
          }
          if (lateAuthTimer) {
            clearTimeout(lateAuthTimer);
          }
          connectSessionStore.get(ticket);
          startBrokerRelay(ticket);
          frameData = rewriteConnectToken(raw, ticket.gatewayToken);
        } else if (resolvedTicket) {
          frameData = rewriteConnectToken(raw, resolvedTicket.gatewayToken);
        }
      }
      const frame: RelayFrame = {
        type: "relay_data",
        sessionId,
        encoding: isBinary ? "base64" : "utf8",
        data: isBinary
          ? (Buffer.isBuffer(frameData) ? frameData : Buffer.from(frameData as ArrayBuffer)).toString(
              "base64"
            )
          : frameData.toString()
      };
      if (relayReady && brokerWs && brokerWs.readyState === WebSocket.OPEN) {
        brokerWs.send(JSON.stringify(frame));
        return;
      }
      pendingFrames.push(frame);
    });

    clientWs.on("close", (code: number, reason: Buffer) => {
      clientClosed = true;
      if (lateAuthTimer) { clearTimeout(lateAuthTimer); }
      if (revalidateInterval) { clearInterval(revalidateInterval); revalidateInterval = null; }
      if (brokerWs && brokerWs.readyState === WebSocket.OPEN) {
        brokerWs.send(
          JSON.stringify({
            type: "relay_close",
            sessionId,
            code,
            reason: reason.toString()
          })
        );
      }
      closeBroker();
    });

    clientWs.on("error", (error: Error) => {
      console.warn("[openclaw-connect] public connect relay ws error", error);
      if (lateAuthTimer) {
        clearTimeout(lateAuthTimer);
      }
      closeBroker();
    });
  }
);

async function getActiveTicket(ticketId: string): Promise<ConnectTicketRecord | null> {
  if (!ticketId.trim()) {
    return null;
  }
  const result = await convexClient.query(getTicketQuery, { ticketId: ticketId.trim() });
  if (!result || typeof result !== "object") {
    return null;
  }
  return result as ConnectTicketRecord;
}

function toPublicConnectSessionStatus(session: {
  ticketId: string;
  phase: ConnectSessionPhase;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  connectedAt?: number;
  error?: string;
}): PublicConnectSessionStatus {
  return {
    ticketId: session.ticketId,
    phase: session.phase,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    connectedAt: session.connectedAt
      ? new Date(session.connectedAt).toISOString()
      : undefined,
    error: session.error,
  };
}

function isPairingRequiredClose(
  code: number | undefined,
  reason: string | undefined,
): boolean {
  return code === 1008 && isPairingRequiredCloseReason(reason);
}

function createConvexClient(): ConvexHttpClient {
  const client = new ConvexHttpClient(CONVEX_URL, {
    skipConvexDeploymentUrlCheck: CONVEX_SKIP_URL_CHECK
  });
  if (CONVEX_TOKEN) {
    const treatAsJwt = CONVEX_TOKEN.split(".").length === 3;
    if (treatAsJwt) {
      client.setAuth(CONVEX_TOKEN);
    } else {
      const withAdminAuth = client as ConvexHttpClient & {
        setAdminAuth?: (value: string) => void;
      };
      if (typeof withAdminAuth.setAdminAuth === "function") {
        withAdminAuth.setAdminAuth(CONVEX_TOKEN);
      } else {
        client.setAuth(CONVEX_TOKEN);
      }
    }
  }
  return client;
}

function resolvePublicRelayUpgradeRequest(req: IncomingMessage): RelayUpgradeRequest | null {
  const directToken = parseDirectConnectRelayToken(req);
  if (directToken) {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    return {
      ticketId: directToken,
      gatewayPath: `${url.pathname || "/"}${url.search}`,
      via: "authorization"
    };
  }

  return parseConnectGatewayRelayRequest(req);
}

function isAnonymousRootUpgradeRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return (url.pathname || "/") === "/";
}

function parseConnectGatewayRelayRequest(req: IncomingMessage): RelayUpgradeRequest | null {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const match = url.pathname.match(/^\/connect\/([^/]+)\/gateway(\/.*)?$/);
  if (!match) {
    return null;
  }
  const suffix = match[2] ?? "";
  const path = suffix.length > 0 ? suffix : "/";
  return {
    ticketId: decodeURIComponent(match[1] ?? ""),
    gatewayPath: `${path}${url.search}`,
    via: "path"
  };
}

function parseDirectConnectRelayToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization ?? "";
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  const legacyHeader = req.headers["x-openclaw-token"];
  const token = Array.isArray(legacyHeader) ? legacyHeader[0] : legacyHeader;
  if (typeof token === "string" && token.trim().length > 0) {
    return token.trim();
  }
  return null;
}

function extractConnectTicketId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      method?: string;
      params?: { auth?: { token?: unknown } };
    };
    if (parsed.type !== "req" || parsed.method !== "connect") {
      return null;
    }
    const token = parsed.params?.auth?.token;
    return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

function rewriteConnectToken(raw: string, gatewayToken: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      method?: string;
      params?: Record<string, unknown> & { auth?: Record<string, unknown> };
    };
    if (parsed.type !== "req" || parsed.method !== "connect") {
      return raw;
    }
    parsed.params = {
      ...(parsed.params ?? {}),
      auth: {
        ...(parsed.params?.auth ?? {}),
        token: gatewayToken
      }
    };
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function buildBrokerRelayWebSocketUrl(): string | null {
  if (!BROKER_ADMIN_URL || !BROKER_ADMIN_TOKEN) {
    return null;
  }
  const url = new URL("/broker/admin/relay", BROKER_ADMIN_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseRequestedProtocols(req: IncomingMessage): string[] {
  return parseRawProtocols(req.headers["sec-websocket-protocol"]);
}

function writeUpgradeError(socket: Socket, statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(
      message
    )}\r\n\r\n${message}`
  );
  socket.destroy();
}
