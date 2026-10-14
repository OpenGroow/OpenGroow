# OpenGroow

OpenGroow is an open-source platform to create and manage Projects made of
agents run by [OpenClaw](https://github.com/openclaw/openclaw). A dashboard
drives the Projects, and agents are installed from packages (Templates) that
can use any MCP server.

This repository is a Turborepo monorepo: isolated apps and shared packages.

## Quick start

Requires Node, pnpm and Docker (running).

```bash
pnpm install
cp .env.example .env     # or: pnpm run setup (creates .env and lists what is missing)
pnpm dev
```

Then open `http://localhost:3912` and create an account (email/password). `.env` at the repository root is the only env file to fill
in. Provider keys of the agents (publishing, video generation, ...) are entered
per Project in the dashboard, not in `.env`.

### Two launch modes: `pnpm dev` and `pnpm start`

- `pnpm dev` (above): for editing the source. Starts Convex, the Dashboard and
  `openclaw-local-control` for you (stopped with Ctrl-C); no manual step to create a Project.
- `pnpm start`: the whole stack in Docker from **published images** (pull, no
  build). Set `OPENCLAW_IMAGE_REGISTRY` in `.env` (e.g. `ghcr.io/<org>`) first.
  **`openclaw-local-control` runs as a container with the Docker socket
  mounted, which is root-equivalent power on your machine** (it must create and
  stop the containers of every Project). Why, and the alternatives:
  [docs/START.md](docs/START.md).

## Architecture (V1)

```text
Dashboard -> Convex
OpenClaw -> Broker (WS) -> Convex
Convex -> Broker (HTTP)
Broker -> OpenClaw (WS push)
```

## Self-Host (Docker Compose)

OSS deployment (issue #266): `docker compose up` brings up the shared
platform (Convex, broker, dashboard, openclaw-connect), secrets
auto-generated on first boot. There is no OpenClaw gateway/runtime-worker in
this stack — every Project's gateway is created dynamically, on demand, by
`openclaw-local-control` when you click "Create New Project" in the
dashboard. There is only one way to get a running Project: through the
dashboard (any number of them — local-multi, issue #306).

```bash
cp .env.example .env
pnpm --filter @opengroow/openclaw-local-control dev & # native host process; dev watches broker Docker start events
docker compose up
```

Dashboard is reachable at `http://localhost:3912` once the stack is healthy.
Project creation depends on `openclaw-local-control` (`http://localhost:4610`
by default) being reachable from the compose stack via
`host.docker.internal` — run it with `pnpm --filter @opengroow/openclaw-local-control dev` before
bringing the stack up, or Convex reports "OpenClaw local control service
unreachable".
See `.env.example` for the full list of overridable ports/URLs and optional
integrations (Telegram, GitHub, Brave Search).

### Dev mode (hot reload)

Editing repo source? Run `pnpm dev`: Convex runs on the host with
`npx convex dev` (local anonymous deployment, state in `.convex/local/default`;
inspect it with `npx convex dashboard`), the Dashboard runs on the host with
`next dev` (port 3912), and only the broker and `openclaw-connect` run in Docker
(`docker-compose.local-convex.yml`). `pnpm dev:down` stops those two containers;
Ctrl-C stops Convex and the Dashboard. For the full Docker stack with hot reload
(`docker compose watch` with `docker-compose.dev.yml`, self-hosted Convex in
containers), use `pnpm dev:docker`. `.env`'s `COMPOSE_FILE` stays untouched;
this is opt-in per invocation.
`openclaw-local-control` still needs to be started separately (see above) —
it's a native host process, not part of the watched services. To iterate on
the OpenClaw gateway/runtime-worker or their control-socket scripts instead,
use `pnpm openclaw:local` — it rebuilds their image and rolls it out to
every already-running local-multi Project.

### Agent Templates: hub and offline start

Official Templates (`@opengroow/*`) are not compiled into OpenGroow (#673): "Add
Agent" installs them from the hub (`OPENGROOW_HUB_REPOSITORY`, default
`OpenGroow/groowhub`) on demand. The one exception is `@opengroow/source`, which
every new Project gets automatically, from a release pinned in the product
(`packages/agent-templates/src/pinned-source.ts`); if the hub cannot be reached
the Project is still created and the install is retried.

With no hub reachable (offline or first self-host start) the Add Agent dialog
says so and lists only what the Project already has. Bootstrap from a local
folder instead; `<projectId>` is the Instance's `openclawId`:

```bash
pnpm template:add <folder> --project <projectId>      # a package folder
pnpm template:add-git <owner/repo> --tag <tag> --digest sha256:<hex> --project <projectId>
```

Everything after `--` is forwarded to `npx convex run` (`--url`, `--admin-key`,
`--prod`). The `@opengroow` scope is only reserved on hosted deployments, so a
self-host operator can install an official package from a folder.

## Package Scripts

Root `package.json` keeps its scripts short — a single-package
alias like `pnpm broker` doesn't exist; use
`pnpm --filter @opengroow/<name> <script>` for that:

**Core (Turborepo)**
- `pnpm typecheck` — typecheck every package (`turbo run typecheck`).
- `pnpm test` — run every Vitest suite (`vitest run`).

**Setup and published-image stack**
- `pnpm run setup` — create `.env` and list what is missing (`scripts/setup.mjs`).
- `pnpm start` / `pnpm start:logs` / `pnpm start:down` — the stack from published images; see [docs/START.md](docs/START.md).

**Docker dev stack**
- `pnpm dev` — local Convex and Dashboard on the host, broker and
  `openclaw-connect` in Docker; see [Dev mode (hot reload)](#dev-mode-hot-reload) above.
- `pnpm dev:down` — stop the Docker containers started by `pnpm dev`.
- `pnpm dev:docker` — the full stack with hot reload in Docker (`docker compose watch`).
- `pnpm openclaw:local [action]` — build the local-multi OpenClaw
  gateway/runtime-worker image and roll it out to every running local-multi
  Project. With no argument, forwards to
  `apps/openclaw-docker-config/scripts/local-stack.sh`.

**Convex**
- `pnpm convex:codegen` — regenerate `apps/convex/_generated` types
  one-shot, without a running dev server.
- `pnpm convex:dashboard` — open the Convex dashboard for the self-host
  Docker stack (`scripts/selfhost-convex-dashboard.sh`).

**OpenClaw images (release/ops, not day-to-day dev)**
- `pnpm openclaw:image:gateway` / `pnpm openclaw:image:runtime-worker` —
  build and push the gateway/runtime-worker image to the registry set by
  `OPENCLAW_IMAGE_REGISTRY` in the root `.env` (no default; log in with
  `docker login` first).

**Templates** (see [docs/TEMPLATE_DEVELOPMENT.md](docs/TEMPLATE_DEVELOPMENT.md))
- `pnpm template:add`, `template:link`, `template:add-git`, `template:validate`, `template:validate-index`, `template:machine-tool`.

**Self-host control**
- `pnpm openclaw:local-control` — run `openclaw-local-control` as a host process (`pnpm --filter @opengroow/openclaw-local-control dev`).

**Other**
- `pnpm openclaw-connect:node-run -- <args>` — runs the "remote helper" CLI
  that pairs a local machine to a dashboard-issued connect ticket; this is
  the exact command the dashboard's "Connect Link" wizard generates for you
  to copy-paste, so its name is fixed — see
  [Remote Chrome Relay](#remote-chrome-relay-user-flow) below.

## Network Schema

OpenClaw Instances connect outbound to the Broker over WebSocket; they need no
public address. The Dashboard talks only to Convex, and Convex talks to the
Broker over signed HTTP. Where each service is exposed depends on the
deployment; the only requirement is that the Broker is reachable by Convex and
by the Instances.

## What Talks to What (Quick Map)

1. **Dashboard → Convex**
   - The dashboard only talks to Convex (queries + mutations).
2. **Convex → Broker (HTTP, HMAC)**
   - Convex pushes commands to the broker.
3. **OpenClaw → Broker (WS, HMAC)**
   - OpenClaw connects outbound only (no public IP needed).
4. **Broker → Convex (HTTP)**
   - Broker forwards events from OpenClaw to Convex.
5. **Broker → OpenClaw (WS push)**
   - Broker pushes commands to the connected OpenClaw instance.

## Convex Data Model (Tables)

- `projects` = the Project as its own entity: stable id, owner, display name, settings (ADR-066)
- `installedTemplates` = the Template packages installed in a Project (the per-Project Template registry)
- `instances` = a Project's OpenClaw execution environment — a remote VM (hosted) or a dynamically-provisioned Docker Compose project (self-host, `openclaw-local-control`)
- `commands` = downstream orders (Dashboard → OpenClaw), `instanceId`, `type`, `payload`, `status`, `attempts`, `lastAttemptAt`, `createdAt`
- `events` = upstream signals (OpenClaw → Dashboard), `instanceId`, `eventId`, `type`, `payload`, `ts`, `createdAt`
- `projectAgents` = an Agent Template activated on a Project (workspace, MCP servers, status)
- `brandCores` = shared brand/voice config used by all Agents of a Project
- `missions` = a unit of work dispatched to an Agent
- `runs` = one execution attempt of a Mission
- `schedules` = recurring Mission triggers (cron-like, evaluated by a periodic tick)
- `projectCounters` = per-Project sequence counters (e.g. `missionCount`)
- `connectTickets` = one-time tickets for pairing a remote node/device to an Instance
- `connectedDevices` = devices paired to an Instance via a connect ticket
- `runReconcileEvents` = append-only decision log for Run reconciliation (one row per tick a decision was applied)

## Packages

- `apps/convex`: backend data and workflow layer — Projects, Agents, Instances, Missions/Runs, Commands, Events, auth, connect tickets
- `apps/broker`: Hono + WebSocket gateway that authenticates OpenClaw connections, forwards dashboard commands to instances, and relays instance events back to Convex
- `apps/dashboard`: Next.js operator UI for creating Projects and managing agent-bearing OpenClaw instances, logs, commands, and admin workflows
- `apps/openclaw-local-control`: Hono control plane that dynamically provisions/tears down self-host local-multi OpenClaw Docker Compose projects. It implements the control-plane contract in `docs/CONTROL_PLANE.md`, which any remote control plane can implement too
- `apps/openclaw-connect`: relay service + CLI runner that pairs a remote OpenClaw node/browser session with a dashboard-issued connect ticket
- `apps/openclaw-docker-config`: Docker images, runtime config, and deployment scripts for running OpenClaw (both remote VMs and self-host)
- `apps/openclaw-runtime-worker`: sidecar that executes broker commands against the OpenClaw gateway and local workspace, streaming results back
- `apps/fake-openclaw`: local WS + HTTP test harness simulating an OpenClaw instance
- `packages/hmac`: shared HMAC helpers (string-to-sign + hashing) used by every cross-service HTTP/WS call
- `packages/protocol`: shared WS/HTTP message types between broker, runtime-worker, and Convex
- `packages/agent-templates`: Agent Template manifests reader and the activation/reconfiguration engine
- Android device automation CLI (`opengroow-android`): a machine-side tool maintained in `private-groowhub` (`tools/android`), invoked by Agents via `exec` on a paired node

## Runtime Control Path

Convex provisions Instances through a generic **control-plane provisioner**
(`apps/convex/instance_provisioning/control_plane.ts`): an HMAC-signed HTTP
client to the service behind `OPENCLAW_CONTROL_URL`. A hosted deployment is
configured with environment variables only (`OPENCLAW_CONTROL_URL`,
`OPENCLAW_CONTROL_KEY_ID`, `OPENCLAW_CONTROL_SECRET`); the provisioner is
selected with `INSTANCE_PROVISIONER` (`control-plane`, the default, or
`local`). The API the control plane must implement is documented in
[docs/CONTROL_PLANE.md](docs/CONTROL_PLANE.md) and pinned by
`apps/convex/test/control_plane_provisioner.test.ts`.

- `apps/openclaw-local-control` is the self-host one (`INSTANCE_PROVISIONER=local`).
- A remote control plane (`INSTANCE_PROVISIONER=control-plane`) is any service implementing the contract; none ships in this repository.
- Config assets come from `apps/openclaw-docker-config`.

## Planes

- **Public edge**: `dashboard`, `openclaw-connect`, and `convex` (public or semi-public).
- **Control plane**: `convex` plus the service behind `OPENCLAW_CONTROL_URL`: orchestration, provisioning, persistence, state transitions.
- **Runtime plane**: `broker`, `openclaw-runtime-worker` and the OpenClaw gateway. Runtime workers connect to `BROKER_WS_URL`; the gateway and runtime worker cooperate on the instance, but only the runtime worker depends on the broker continuously.

A healthy local gateway does not mean the runtime plane works: if `BROKER_WS_URL`
is unreachable from the instance, the runtime plane is broken even while `broker`
itself is healthy.

## Remote Chrome Relay (User Flow)

`pnpm openclaw-connect:node-run` is a repo helper, not a standalone binary.
It needs:
- this repo checked out locally
- `pnpm install` already done
- the project-local OpenClaw CLI installed by `pnpm install` (pinned to the
  version in `apps/openclaw-connect/package.json`)
- the OpenClaw Chrome extension installed on the same machine as Chrome

Recommended flow:
1. In OpenGroow, click `Create connect link`.
2. Copy the helper command generated by the dashboard.
3. Run it on the machine that hosts Chrome, with a unique `--display-name`.
4. If this is the first run for that node identity, approve it with `List pending devices` / `Approve`.
5. Pin browser routing once with `config set gateway.nodes.browser.node "<display-name>"`.
6. Ask OpenClaw to perform one browser action. This first call starts the local extension relay on `127.0.0.1:18792`.
7. Click the OpenClaw extension icon on the target tab until the badge shows `ON`.
8. Retry the browser action.

Notes:
- Pairing the node and attaching a Chrome tab are two different steps.
- If another local OpenClaw daemon is already running on the same machine, stop it first to avoid port/config conflicts.
- The helper uses the project-local OpenClaw CLI by default. Pass
  `--openclaw-bin <path>` only when an explicit alternate binary is required.

## Run (local)

Prepare local env files first:

```bash
cp apps/convex/.env.local.example apps/convex/.env.local
```

Terminal 1 (Convex local dev):

```bash
pnpm --filter @opengroow/convex-app dev
```

Terminal 2 (Broker):

```bash
pnpm --filter @opengroow/broker dev
```

Terminal 3 (Dashboard):

```bash
pnpm --filter @opengroow/dashboard dev
```

Terminal 4 (local OpenClaw control, self-host provisioning):

```bash
pnpm openclaw:local-control
```

Terminal 5 (Fake OpenClaw: WS + HTTP):

```bash
OPENCLAW_PORT=4301 pnpm --filter @opengroow/fake-openclaw dev
```

For the full stack via Docker instead of separate terminals, see
[Dev mode (hot reload)](#dev-mode-hot-reload) above (`pnpm dev`).

## Test

Open `/broker-test` in the dashboard to send commands and view events.

Fake OpenClaw HTTP endpoint to push an event (uses active WS):

```bash
curl -X POST http://127.0.0.1:4301/send-event \
  -H "content-type: application/json" \
  -d '{"type":"manual_event","payload":{"note":"hello"}}'
```

Automated tests:

```bash
pnpm test
```

Notes:
- `apps/convex/_generated` is produced by `pnpm --filter @opengroow/convex-app dev` and used by broker/dashboard at build time.
- Set `CONVEX_SKIP_URL_CHECK=1` if you use a non-standard Convex URL.
- App env files are loaded from each app root (`.env.local`).
- The dashboard is the auth origin: set `DASHBOARD_URL` in `apps/convex/.env.local`.

## OpenClaw Control API

Convex reaches the service that creates OpenClaw instances through an HMAC-signed HTTP API. Endpoints, headers, string-to-sign and Convex env (`OPENCLAW_CONTROL_URL`, `OPENCLAW_CONTROL_KEY_ID`, `OPENCLAW_CONTROL_SECRET`) are specified in [docs/CONTROL_PLANE.md](docs/CONTROL_PLANE.md); the self-host implementation is `apps/openclaw-local-control`.

## Broker WS (OpenClaw)

Headers required on WS connect:
- `x-openclaw-key-id`
- `x-openclaw-ts`
- `x-openclaw-nonce`
- `x-openclaw-signature` (HMAC SHA256)

String to sign:
```
GET\n/openclaw\n{ts}\n{nonce}
```

Secrets registry (env):
`BROKER_OPENCLAW_KEYS='{"dev":{"openClawId":"openclaw-dev-1","secret":"dev-secret"}}'`

Security options:
- `BROKER_HMAC_MAX_SKEW_MS` (default `300000`)
- `BROKER_HMAC_NONCE_TTL_MS` (default `300000`)

## Broker HTTP (Convex -> Broker)

Endpoint:
`POST /broker/commands`

Headers required:
- `x-broker-key-id`
- `x-broker-ts`
- `x-broker-nonce`
- `x-broker-signature` (HMAC SHA256)

String to sign:
```
POST\n/broker/commands\n{ts}\n{nonce}\n{sha256(body)}
```

Secrets registry (env):
`BROKER_CONVEX_KEYS='{"convex":{"secret":"convex-secret"}}'`

Convex env required:
- `BROKER_URL` (default `http://127.0.0.1:4300`)
- `BROKER_KEY_ID` (default `convex`)
- `BROKER_SECRET` (default `convex-secret`)

## Key Flows (Step-by-Step)

### 1) Command flow (Dashboard → OpenClaw)
1. Dashboard calls `api.commands.enqueue`
2. Convex stores a `commands` row
3. Convex scheduler runs `commands_node.dispatch`
4. Convex sends `POST /broker/commands` (HMAC)
5. Broker pushes command over WS to the OpenClaw socket
6. OpenClaw replies with `{type:"command_ack", commandId}`
7. Broker calls `commands.ack` to mark `status=acked`

### 2) Event flow (OpenClaw → Dashboard)
1. OpenClaw sends `{type:"event"}` over WS
2. Broker calls Convex action `events.ingest`
3. Convex stores into `events`
4. Dashboard query `events.listRecent` updates in real time

## Idempotency & Replays

- **Commands**: `commandId` is the Convex document `_id`.
- **Events**: OpenClaw must send a unique `eventId`. Convex de-dupes on `(instanceId, eventId)`.
- **HMAC**: timestamps are checked (±5 min by default) and nonces are cached in memory for TTL.

## License

OpenGroow is licensed under the GNU Affero General Public License v3.0 only
(`AGPL-3.0-only`), see `LICENSE`. If you run a modified version as a network
service, you must offer its source to its users. The licence does not prevent
others from offering the unmodified product as a service.

The self-host stack pulls the Convex backend image, which is distributed by
Convex under its own source-available terms (FSL-1.1-Apache-2.0). Dependency and
image audit: `docs/LICENSING.md`. The official Template hub is MIT licensed.
