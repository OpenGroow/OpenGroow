OpenClaw Local Control is the Hono control plane that provisions and tears down local multi-instance OpenClaw Docker Compose projects, structurally mirroring the role of the remote control plane (contract: docs/CONTROL_PLANE.md).

Run: `pnpm --filter @opengroow/openclaw-local-control dev`

`pnpm dev` (root) starts it in the background; `pnpm start` runs it as a container with the Docker socket mounted (Dockerfile in this folder, `docker-compose.start.yml`, docs/START.md). Paths to `apps/openclaw-docker-config/docker` must be identical on the host and in the container (`OPENCLAW_LOCAL_CONTROL_DOCKER_DIR`).
