# ADR-006: openclaw-connect as a separate service

**Status:** Accepted

### Context

In development, a developer wants to connect a local OpenClaw process (behind NAT, with no public IP) to the cloud dashboard to test without deploying a Hetzner VM. This use case is fundamentally different from the production flow.

### Decision

`openclaw-connect` is a relay service **separate** from the Broker:

- The local CLI initiates an outbound connection to `openclaw-connect` (reverse tunnel pattern, similar to ngrok/Cloudflare Tunnel).
- `openclaw-connect` maintains an ephemeral tunnel and relays exchanges between the dashboard and the local process.
- The production Broker stays unchanged and isn't polluted by local pairing logic.

**Reasons for the separation:**

| Dimension | Broker (production) | openclaw-connect (dev) |
|---|---|---|
| Lifetime | Long-lived, stable | Ephemeral, burst |
| Audience | OpenClaw VM instances | Local developers |
| Security constraints | Production surface | Isolated dev/local surface |
| Scaling | Must be HA | Low usage, tolerant of downtime |

### Consequences

- The dev/prod security surface is clearly separated — a flaw in local pairing doesn't impact production agents.
- Two services to maintain for connectivity, but with clear responsibilities.
- Pairing tickets (`connectTickets` in Convex) are short-lived and cleaned up automatically.
