## HMAC authentication

Every cross-service HTTP call is signed. String-to-sign format:

```
{METHOD}\n{PATH}\n{ts}\n{nonce}\n{sha256(body)}   # HTTP
GET\n/openclaw\n{ts}\n{nonce}                       # WS connect
```

Key registries are passed as JSON env vars:

- `BROKER_CONVEX_KEYS` — Convex → Broker
- `BROKER_OPENCLAW_KEYS` — OpenClaw → Broker (WS)
- `OPENCLAW_CONTROL_KEYS` — Convex → Control API
- `OPENCLAW_LOCAL_CONTROL_KEYS` — Convex → Local Control API
