# ADR-004: Hono + WebSocket Broker as the OpenClaw gateway

**Status:** Accepted

### Context

The dashboard needs to send commands to OpenClaw instances and receive their events back. A direct connection between Convex and OpenClaw is impossible for two reasons:

1. Convex is serverless — it can't maintain a long-lived WebSocket connection server-side.
2. OpenClaw instances have no public IP and therefore can't receive inbound connections.

### Decision

A dedicated service — the **Broker** (Hono + Node.js WebSocket) — acts as a stateful gateway:

- OpenClaw instances initiate an **outbound** WebSocket connection to the Broker (HMAC-signed).
- Convex pushes commands to the Broker over HTTP (HMAC-signed).
- The Broker relays the command to the relevant instance over the active WS connection.
- Events flow back in the opposite direction: OpenClaw → Broker (WS) → Convex (HTTP).

```
Dashboard → Convex ← → Broker (HTTP/HMAC)
OpenClaw → Broker (WS/HMAC) → Convex (HTTP)
```

### Consequences

- The Broker is **stateful**: WS connections live in memory. In V1, a single Broker instance is enough.
- Horizontal scaling of the Broker will require a message bus (Redis pub/sub, NATS) to route commands between instances — decision deferred.
- Hono was chosen for its lightweight footprint and native compatibility with Node.js WebSockets.
