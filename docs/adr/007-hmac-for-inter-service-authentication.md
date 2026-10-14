# ADR-007: HMAC for inter-service authentication

**Status:** Accepted

### Context

Three inter-service flows need authentication:

- Convex → Broker (HTTP)
- OpenClaw → Broker (WebSocket)
- Convex → openclaw-control (HTTP)

The classic alternatives are JWT (signed tokens) and mTLS (mutual certificates).

### Decision

All inter-service calls are signed via **HMAC-SHA256** with a key shared per pair of services.

Signed string format:

```
# HTTP
{METHOD}\n{PATH}\n{timestamp}\n{nonce}\n{sha256(body)}

# WebSocket (handshake)
GET\n/openclaw\n{timestamp}\n{nonce}
```

Key registries are passed via JSON environment variables:

- `BROKER_CONVEX_KEYS` — Convex → Broker
- `BROKER_OPENCLAW_KEYS` — OpenClaw → Broker
- `OPENCLAW_CONTROL_KEYS` — Convex → Control API

**Reasons for choosing HMAC:**

1. **Implementation simplicity** — native Node.js/Web crypto, zero external dependency, shared `@megaclaw/hmac` package in the monorepo.
2. **Stateless, no PKI** — no certificates to generate, renew, or distribute. No internal CA. No custom TLS handshake.
3. **Fine-grained control per service pair** — each service↔service relationship has its own key, enabling targeted revocation and independent rotation without impacting other flows.

### Consequences

- Security relies on the confidentiality of the keys in environment variables — a secret leak compromises the corresponding flow.
- The timestamp + nonce in the signature prevents replay attacks.
- If Megaclaw needs to expose services to untrusted third parties, mTLS or OAuth2 client_credentials would be more appropriate — HMAC remains an internal-trust choice.
- Key rotation is manual (updating env vars + redeploying).
