# OpenClaw Docker Config

The OpenClaw container images and their configuration: the **gateway** image (bundles the OpenClaw CLI and the control socket) and the **runtime-worker** image (lightweight broker bridge sidecar). Self-host builds them locally with `pnpm openclaw:local`; anyone can also publish them to their own registry.

**Note:** This is a minimal, generic configuration with only essential skills activated. You are encouraged to customize it by adding [ClawHub skills](https://clawhub.ai/) (see [Working with Skills](#working-with-skills)).

## Layout

| Path                        | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `OPENCLAW_VERSION`          | Pinned OpenClaw version bundled in the gateway image                 |
| `docker/Dockerfile`         | Gateway image                                                        |
| `docker/runtime-worker/`    | Runtime-worker image                                                 |
| `docker/docker-compose.yml` | Compose fragment running both images                                 |
| `docker/.env.example`       | Documents the environment variables the stack reads                  |
| `config/`                   | `openclaw.json`, security rules and the skills manifest baked in the image |
| `scripts/`                  | Build, publish, validation and local-stack scripts                   |

## Prerequisites

- Docker with Buildx
- A checkout of the whole monorepo (the runtime-worker image is built from `apps/openclaw-runtime-worker` and `packages/`)
- `jq` (config validation) and Git (image tags use the short commit SHA)

## Building the images locally

From the repository root:

```bash
pnpm openclaw:local
```

This builds both images with the `:local` tag and rolls them out to running self-host Projects (see `scripts/local-stack.sh`).

To build a single image by hand:

```bash
# Gateway (context: this folder)
docker build -f apps/openclaw-docker-config/docker/Dockerfile \
  -t openclaw-gateway:dev apps/openclaw-docker-config

# Runtime worker (needs a minimal monorepo context, prepared by a script)
ctx="$(mktemp -d)"
apps/openclaw-docker-config/scripts/prepare-runtime-worker-context.sh "$ctx"
docker build -f "$ctx/apps/openclaw-docker-config/docker/runtime-worker/Dockerfile" \
  -t openclaw-runtime-worker:dev "$ctx"
```

## Publishing to your own registry

The publish scripts have **no default registry**. Set `OPENCLAW_IMAGE_REGISTRY` to the registry path you own (for example `registry.example.com/<team>`), log in with your registry's usual `docker login`, then run:

```bash
export OPENCLAW_IMAGE_REGISTRY=registry.example.com/<team>
docker login registry.example.com

# gateway + runtime-worker, tagged :latest and :<git-sha>
./apps/openclaw-docker-config/scripts/build-and-push.sh
# a custom tag instead of :latest
./apps/openclaw-docker-config/scripts/build-and-push.sh v1

# runtime-worker only
./apps/openclaw-docker-config/scripts/build-and-push-runtime-worker.sh
```

Or through the root scripts, which load `OPENCLAW_IMAGE_REGISTRY` from the root `.env`:

```bash
pnpm openclaw:image:gateway          # gateway + runtime-worker
pnpm openclaw:image:runtime-worker   # runtime-worker only
```

Resulting images (platform `linux/amd64`):

- `$OPENCLAW_IMAGE_REGISTRY/openclaw-gateway:<tag>` and `:<sha>`
- `$OPENCLAW_IMAGE_REGISTRY/openclaw-runtime-worker:<tag>` and `:<sha>`

`docker/docker-compose.yml` consumes them through `OPENCLAW_IMAGE_REF` and `OPENCLAW_RUNTIME_WORKER_IMAGE_REF`. Prefer immutable digest refs (`...@sha256:...`) for deployments and rollbacks.

## Upgrading OpenClaw

1. Bump the version in `OPENCLAW_VERSION`.
2. Rebuild the images (`pnpm openclaw:local`, or publish with the scripts above).
3. Re-validate the config against the new build: `bash scripts/validate-config.sh`.

Only the gateway image bundles the OpenClaw CLI; the runtime-worker never needs a rebuild for an OpenClaw bump. Note: the config validator blocks `gateway.tools` until the pinned build is deliberately revalidated.

## Configuration

- `config/openclaw.json` is the default OpenClaw configuration. Secrets are never written in it: use `${ENV_VAR}` references, and see `docker/.env.example` for the variables the stack expects.
- Validate before committing: `bash scripts/validate-config.sh` (JSON validity, raw API key patterns) and `bash scripts/check-secrets.sh` (tracked files scan). Both run in the publish scripts.
- Enable the pre-commit hook that runs them: `git config core.hooksPath .githooks`.

## Working with Skills

`config/skills-manifest.txt` lists generic [ClawHub](https://clawhub.ai/) skills. `docker/entrypoint.sh` installs every listed skill on container start with `clawhub install`.

To add one: find it at [clawhub.ai](https://clawhub.ai/), add its name to `config/skills-manifest.txt` (one per line, `#` for comments), then rebuild the image.

Default skills:

| Skill                  | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `yt`                   | YouTube transcript fetching and video search          |
| `agent-browser`        | Headless browser for JavaScript-heavy/paywalled pages |
| `system-monitor`       | CPU/RAM/GPU status check                              |
| `conventional-commits` | Format commit messages per convention                 |

For skill development, see the [OpenClaw Skill Development Guide](https://docs.openclaw.ai/skills).

## Accessing the gateway

The gateway binds to loopback only (`127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18789}`). On a remote machine, reach it through an SSH tunnel:

```bash
ssh -N -L 18789:127.0.0.1:18789 <user>@<host>
```

then open `http://localhost:18789`.

## Troubleshooting

- **Container won't start:** `docker compose logs openclaw-gateway`; look for missing environment variables or invalid config JSON.
- **Permission denied on the config directory:** make sure the host directories mounted by `docker-compose.yml` exist and are owned by uid 1000 (`chown -R 1000:1000 <dir>`).
- **Config validation fails:** run `bash scripts/validate-config.sh`. Common causes: invalid JSON (trailing comma) or a raw API key pasted into `openclaw.json`.
- **Runtime-worker bridge:** its logs should show `[runtime-worker] forwarding 127.0.0.1:18789 -> openclaw-gateway:18789`.
