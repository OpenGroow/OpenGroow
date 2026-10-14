# ADR-001: Convex as the primary backend

**Status:** Accepted

### Context

Megaclaw orchestrates autonomous AI agents: the dashboard must reflect agent state (running, queued, done) in real time, and commands sent to OpenClaw must be scheduled, retried, and traced reliably.

### Options considered

- NestJS + PostgreSQL + manual WebSockets
- Supabase (PostgreSQL + realtime)
- Convex

### Decision

Convex is chosen as the single backend layer.

**Reasons:**

1. **End-to-end typing** — Convex query/mutation types are generated automatically and consumed directly by the Next.js dashboard, with no manual generation step and no OpenAPI contract to maintain.
2. **Native real-time** — Convex subscriptions let the dashboard react instantly to agent and run state changes, with no polling and no WebSocket infrastructure to build.
3. **Scheduler + queue out of the box** — `ctx.scheduler.runAfter` and `ctx.scheduler.runAt` replace a queue worker (BullMQ, etc.) for orchestrating commands and agent runs, with persistence and retry included.

### Consequences

- All business code (queries, mutations, actions, crons) lives in `apps/convex`.
- The dashboard only talks to Convex — never directly to the Broker or to OpenClaw instances.
- Node-only actions (HTTP calls, HMAC) are isolated in `*_node.ts` files to remain compatible with the Convex runtime.
- Vendor lock-in on Convex; a future migration to a classic backend would require rewriting the data layer and the real-time layer.
