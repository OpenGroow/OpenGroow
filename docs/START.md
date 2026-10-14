# `pnpm start`: the stack in Docker from published images

`pnpm dev` is for editing the source. `pnpm start` runs the whole stack as
containers, **pulling published images** (no build): self-hosted Convex,
Dashboard, broker, `openclaw-connect` and `openclaw-local-control`.

```bash
pnpm run setup            # creates .env
# edit .env: OPENCLAW_IMAGE_REGISTRY=<registry>/<org>   (e.g. ghcr.io/<org>)
pnpm start                # pre-flight check of .env, pull, up -d
pnpm start:logs
pnpm start:down
```

`scripts/start-check.mjs` runs first and stops with a list of what is missing
(`.env`, empty REQUIRED variables, `OPENCLAW_IMAGE_REGISTRY`, which must be
lowercase, and `OPENCLAW_START_CONTROL_SECRET`). `pnpm run setup` generates that
secret: it is the HMAC key between Convex and `openclaw-local-control`, which
mounts the Docker socket, so there is no default and the container refuses the
built-in one. There is no default registry on purpose: image references are
`${OPENCLAW_IMAGE_REGISTRY}/opengroow-<name>:${OPENCLAW_IMAGE_TAG:-latest}`
(`docker-compose.start.yml`).

Images and the workflows that publish them (`.github/workflows/*-image.yml`,
registry from the repository variable `IMAGE_REGISTRY`, default
`ghcr.io/<repository owner>`): `opengroow-broker`, `opengroow-dashboard`,
`opengroow-convex-bootstrap`, `opengroow-openclaw-connect`,
`opengroow-openclaw-local-control`. The per-Project gateway and runtime-worker
images are `${OPENCLAW_IMAGE_REGISTRY}/openclaw-gateway` and
`/openclaw-runtime-worker` (published by the `openclaw:image:*` scripts); they
are pulled by `docker compose` when a Project is created.

## Why `openclaw-local-control` gets the Docker socket

A Project is one OpenClaw Instance: `openclaw-local-control` runs
`docker compose -p openclaw-<id> up -d` (and `down`, `docker cp` into the
broker, `docker restart`) for it. Inside a container, the only way is to mount
the host's `/var/run/docker.sock`.

**That is root-equivalent power on the machine**: whoever can call the socket
can start a privileged container that mounts the host filesystem. This is
acceptable for self-hosting, where you own the machine and the only caller is
this stack, but do not expose the stack to untrusted users. Mitigations in
place: the service has no published host port (only `convex-backend` reaches it
on the compose network) and its API requires HMAC-signed requests.

Alternatives evaluated:

- **Socket proxy** (e.g. tecnativa/docker-socket-proxy): filters by API section
  (containers, volumes, networks...), not by content. This service needs
  `POST /containers/create`, which is already enough to create a privileged
  container, so the proxy adds a moving part without removing the root
  equivalence. Rejected.
- **Rootless Docker**: a host-level choice that really does bound the blast
  radius (the socket is then your own user's). Supported as is: point
  `OPENCLAW_DOCKER_SOCKET` in `.env` at the rootless socket
  (e.g. `/run/user/1000/docker.sock`). Not tested.
- **`pnpm dev`** keeps `openclaw-local-control` as a host process (no socket
  mount); use it if you do not want this trade-off.

The Android CLI (ADB phone driving) stays on the host in both modes.

## Compose path identity

`docker compose` runs inside the container, but the Docker daemon resolves
paths on the host. `scripts/start.sh` therefore exports
`OPENCLAW_HOST_DOCKER_DIR` (the host path of
`apps/openclaw-docker-config/docker`), and `docker-compose.start.yml` mounts it
read-only at the **same absolute path** inside the container and sets
`OPENCLAW_LOCAL_CONTROL_DOCKER_DIR` to it. Per-Project data lives in named
volumes (not bind mounts), so no other host path is involved.

## Verification status

Verified: compose config resolves with no `build`, the local-control image
builds, runs, reaches the host socket and resolves the instance compose files
at the mounted path. Not verified (needs a clean machine and a real registry):
pulling the published images, creating a Project end to end, rootless Docker.
