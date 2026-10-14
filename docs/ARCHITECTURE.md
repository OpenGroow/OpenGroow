When the user asks to remove a feature, remove the implementation entirely. Do not keep compatibility wrappers, fallback paths, stub actions, or dead code unless the user explicitly asks for a phased deprecation.

Prefer deep modules with small, high-leverage interfaces over oversized source files that directly manage every operational detail. When a file starts accumulating multiple responsibilities or forcing readers to hold too much branching logic in their head, split it by responsibility behind clearer high-level seams instead of growing a single orchestration file.

Dashboard → Convex ← → Broker (HTTP/HMAC)
OpenClaw → Broker (WS/HMAC) → Convex (HTTP)

- **Dashboard** talks only to Convex (queries + mutations via Convex React client).
- **Convex** schedules `commands_node.dispatch` to push commands to the broker over HTTP (HMAC-signed).
- **Broker** maintains WebSocket connections from OpenClaw instances; forwards events to Convex via `events.ingest`.
- **A control plane** provisions Instances behind the generic provisioner: `openclaw-local-control` in self-host, or any service implementing [CONTROL_PLANE.md](CONTROL_PLANE.md) (ADR-061).

## Monorepo structure

Turborepo + pnpm workspaces. Key apps:

- `apps/convex` — Convex backend (schema, queries, mutations, actions, HTTP routes)
- `apps/broker` — Hono + WebSocket gateway; OpenClaw instances connect here
- `apps/dashboard` — Next.js 15 dashboard (App Router)
- `apps/openclaw-local-control` — self-host control plane (remote ones implement `docs/CONTROL_PLANE.md`)
- `apps/openclaw-connect` — pairing relay between a remote machine (node) and the Broker
- `apps/openclaw-runtime-worker` — sidecar that executes broker commands against the OpenClaw gateway and the Project's workspace
- `apps/openclaw-docker-config` — Docker/runtime config assets for OpenClaw VMs
- `apps/fake-openclaw` — local WS + HTTP test harness
- `packages/hmac` — shared HMAC helpers
- `packages/protocol` — shared WS/HTTP message types
- `packages/reliability` — shared bounded-retry primitive (ADR-033), used by `apps/convex` and `apps/openclaw-connect`

## Official OpenClaw Plugins (OPENCLAW_OPTIONAL_PLUGINS)

The Instance image ships none of the official OpenClaw plugins (Codex, WhatsApp, Xiaomi, Groq): the operator lists the ones to offer in `OPENCLAW_OPTIONAL_PLUGINS` (comma-separated ids `codex,whatsapp,xiaomi,groq`; empty by default). Decision record: [ADR-068](adr/068-official-openclaw-plugins-enabled-at-start.md); vocabulary: [docs/domain/runtime.md](domain/runtime.md).

- **The variable is the source of truth.** At every start, before the gateway, the Instance (`docker/optional-plugins.js`, called by `entrypoint.sh`) installs what is listed and uninstalls the rest. A failure only logs a warning and the next start tries again. Uninstalling WhatsApp erases its channel config.
- **Three readers, each with its own copy of the value**: the Instance (reconciles), the Dashboard (`process.env` in the root layout, hides the cards and flows of a plugin that is not listed) and Convex (`env.OPENCLAW_OPTIONAL_PLUGINS`, refuses WhatsApp actions and keeps the link watchdog away when `whatsapp` is not listed). The ids and the parser shared by Dashboard and Convex are in `packages/protocol/src/optional-plugins.ts`; the Instance has its own copy of the id list (plain CommonJS in the image).
- **Where to set it**: `.env` (see `.env.example`), passed on by both compose files, `scripts/dev-local.sh` (Convex) and the Convex bootstrap entrypoint. In the cloud, repeat the same value on every Instance and on the Dashboard and Convex deployments. After changing it locally, restart `pnpm dev` (Convex keeps its copy) and recreate the Instances (`pnpm openclaw:local`).
- **Known limit**: neither the Dashboard nor Convex checks the real plugin state, so a failed install still shows the feature as available (see ADR-068, "Not verified").

## Official Template hubs (local clones)

Official Templates live outside this repository, in two hub repositories laid out like `hub-template/` (`index.json`, `packages/<name>/`, validation and release workflows):

- `OpenGroow/groowhub` (public, `@opengroow/source` and later the public Templates): installable from the hub by anyone.
- `OpenGroow/private-groowhub` (private staging: Templates not yet generic enough to publish): the installer downloads without authentication, so these are installed from a local clone, per Project.

Convention for local clones, next to this checkout: `~/Projects/groowhub` and `~/Projects/private-groowhub`.

```bash
# install a private Template into a Project (add --prod/--url/--admin-key after `--` to target another deployment)
pnpm template:add ~/Projects/private-groowhub/packages/<name> --project <projectId>

# iterate on a Template folder without re-adding it
pnpm template:link ~/Projects/private-groowhub/packages/<name> --project <projectId>

# validate a package, or an index, with the reader used at installation
pnpm template:validate ~/Projects/private-groowhub/packages/<name> [--tag <name>@1.0.0]
pnpm template:validate-index ~/Projects/groowhub/index.json
```

`hello` (a `development` fixture) stays in this repository. Releases: push a tag `<name>@<version>` in the hub repository; the workflow builds the `.tgz` and updates the index entry (see the hub's README).
