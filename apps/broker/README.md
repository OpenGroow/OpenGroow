# Broker

Hono + WebSocket gateway that authenticates OpenClaw connections, forwards dashboard commands to instances, and relays instance events back to Convex.

Run: `pnpm --filter @opengroow/broker dev`

## Configuration

| Variable | Meaning |
|---|---|
| `CONVEX_URL` | Convex backend URL. On a shared Docker network, prefer the internal URL (`http://convex-backend:3210`) over a public one: routing through a public proxy makes broker health depend on it. |
| `CONVEX_TOKEN` | Convex admin key (the self-host stack loads it from `CONVEX_ADMIN_KEY_FILE`). |
| `BROKER_CONVEX_KEYS` | HMAC key registry for Convex -> broker calls, e.g. `{"convex":{"secret":"..."}}`. |
| `BROKER_ADMIN_TOKEN` | Token for the broker admin API. |
| `BROKER_OPENCLAW_KEYS_FILE` | File persisting the dynamic OpenClaw keys (put it on a volume). `BROKER_OPENCLAW_KEYS` stays a static fallback. |

The HMAC conventions are in [docs/HMAC.md](../../docs/HMAC.md); the self-host stack wiring is in the root `docker-compose.yml`.
