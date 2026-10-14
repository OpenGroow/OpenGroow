# Local ports

Single reference for the ports the product uses locally, so nobody has to
search every `.env`, `docker-compose.yml` and `package.json`. Keep it up to
date when a port changes or a service is added.

## Product services (`docker compose`, see `.env` and `.env.example`)

| Service | Port | Defined in |
|---|---|---|
| `dashboard` (product) | 3912 | `docker-compose.yml`, `DASHBOARD_PORT` |
| `convex-backend` (cloud API) | 3210 | `apps/convex/docker/docker-compose.yml`, `CONVEX_PORT` |
| `convex-backend` (site proxy) | 3211 | same file, `CONVEX_SITE_PROXY_PORT` |
| `convex-dashboard` (Convex admin, distinct from the product dashboard) | 6791 | same file, `CONVEX_DASHBOARD_PORT` |
| `broker` | 4300 | `docker-compose.yml`, `BROKER_HOST_PORT` |
| `openclaw-connect` (pairing relay) | 4700 | `docker-compose.yml`, `OPENCLAW_CONNECT_PORT` |
| `openclaw-gateway` (base stack image) | 18789 | `apps/openclaw-docker-config/docker/docker-compose.yml`, `OPENCLAW_GATEWAY_PORT` |
| `openclaw-local-control` (native host process under `pnpm dev`; container not published on the host under `pnpm start`; control API) | 4610 | `apps/openclaw-local-control/src/config.ts`, `OPENCLAW_LOCAL_CONTROL_PORT` |
| Gateway per **Project** (local-multi, one per created Instance) | **dynamic**, allocated from 19100 | `apps/openclaw-local-control/src/config.ts` (`basePort`) + `port-allocator.ts` |

The last port is **not fixed**: each "Create Project" allocates the first free
port from 19100, so several can run in parallel with different values. See the
`openclaw-local-control` registry for the actual value of a given Instance.

## MCP servers declared by Templates

Each Template declares the MCP servers it needs (`profiles/opengroow.yml`:
`url` as seen from the OpenClaw container, `activationUrl` as seen from
Convex). Those servers are not part of the product and their ports are not
reserved here; the Template's own README says how to run them. Pick ports that
do not collide with the table above (the broker listens on 4300, the connect
relay on 4700, the local control on 4610).
