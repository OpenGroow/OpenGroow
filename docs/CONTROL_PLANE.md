## Control-plane API contract

Convex provisions Instances through the generic **control-plane provisioner**
(`apps/convex/instance_provisioning/control_plane.ts`). The product contains no
hosting-provider code: whatever sits behind `OPENCLAW_CONTROL_URL` (servers,
networks, proxies...) is a separate service that implements the API below. The
product ships one implementation, the self-host `apps/openclaw-local-control`;
the hosted offer lives in a separate private repository and talks to the
product only through this contract (#719). The contract is pinned by
`apps/convex/test/control_plane_provisioner.test.ts` (behavior) and
`apps/convex/test/control_plane_contract_doc.test.ts` (this document lists every
route the provisioner calls).

### Configuration (environment variables only)

| Variable | Meaning |
|---|---|
| `INSTANCE_PROVISIONER` | `control-plane` (default) or `local` (`apps/openclaw-local-control`, same wire shape minus fleet rollout). |
| `OPENCLAW_CONTROL_URL` | Base URL of the control plane. |
| `OPENCLAW_CONTROL_KEY_ID` | HMAC key id. |
| `OPENCLAW_CONTROL_SECRET` | HMAC secret. |
| `OPENCLAW_CONTROL_FETCH_TIMEOUT_MS` | Optional, default 8000. |

`IS_SELF_HOST` is not the provisioner selector. It only drives trust rules
(outbound URL checks, scope reservation, MCP URL overrides).

### Authentication

Every request is HMAC-signed with the `control` header prefix (see
[HMAC.md](HMAC.md)): headers `x-control-key-id`, `x-control-ts`,
`x-control-nonce`, `x-control-signature`; string-to-sign
`{METHOD}\n{PATH}\n{ts}\n{nonce}\n{sha256(body)}`. The control plane's key
registry is `OPENCLAW_CONTROL_KEYS`. Bodies are JSON (`content-type:
application/json`); `GET` requests have no body.

### Errors

Responses are JSON and carry a `status` field mirroring the HTTP status.
Failures use `{ "status": <code>, "error": "<message>" }`. When the control
plane is unreachable or times out, the provisioner itself returns
`{ status: 502 | 504, error: "OpenClaw control service unreachable" | "... timed out" }`
without throwing. A non-JSON body is returned as `{ status, raw }`.

### Endpoints

| Provisioner method | Request | Body | Success response |
|---|---|---|---|
| `createInstance` | `POST /instances/jobs` | `{ nameSuffix?, openClawImageRef? }` | `202 { accepted, job }` |
| `removeInstance` | `POST /instances/delete` | `{ jobId, serverId?, serverName?, peerName? }` | `200 { ok, serverDeleted, ... }` |
| `list` (one) | `GET /instances/jobs/{jobId}` | none | `200 { job }`, `404` if unknown |
| `list` (all) | `GET /instances/jobs` | none | `200 { jobs }` |
| `logs` | `POST /instances/logs/{openclaw\|broker}` | `{ serverId?, ipv4?, service?, tail? }` | `200 { output, ... }` |
| `status` | `POST /instances/status/{openclaw\|broker}` | `{ serverId?, ipv4? }` | `200 { ... }` (runtime status) |
| `rollout` | `POST /instances/rollout` | `{ ips, openClawImageRef?, concurrency?, refreshCompose? }` | `202 { accepted, job }` |

Undefined body fields are omitted from the JSON. `serverId`, `serverName` and
`peerName` are opaque identifiers owned by the control plane; the product only
stores and echoes them (stored field names `openclawServerId`, `openclawName`,
... are unchanged). `peerName` names the instance's entry in the control
plane's private network, if any, so it can be cleaned up on removal.

### Job payload

`createInstance` and `list` return job objects of this shape (see
`InstanceJobPayload` in `instance_provisioning/types.ts`); everything except
`id`, `status`, `runtimeStatus` and `createdAt` is optional:

```json
{
  "id": "job-1",
  "status": "queued | running | succeeded | failed",
  "runtimeStatus": "...",
  "createdAt": "ISO-8601",
  "startedAt": "ISO-8601", "finishedAt": "ISO-8601", "error": "...",
  "network": { "id": 1, "name": "...", "ipRange": "..." },
  "broker": { "serverId": 1, "name": "...", "ipv4": "...", "privateIp": "..." },
  "openclaw": {
    "serverId": 2, "name": "...", "ipv4": "...", "privateIp": "...",
    "openClawId": "...", "openClawKeyId": "...", "gatewayToken": "..."
  }
}
```

Jobs are asynchronous: the dashboard polls `list` until `status` is terminal,
then Convex persists the job into the `instances` table.
