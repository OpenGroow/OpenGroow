#!/usr/bin/env bash
# `pnpm start` entry point (#718): the whole stack in Docker from PUBLISHED
# images (pull, no build). Convex self-hosted, dashboard, broker,
# openclaw-connect and openclaw-local-control, all as containers.
# See docs/START.md. For editing the source, use `pnpm dev`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ACTION="${1:-up}"
case "$ACTION" in
  up | down | logs) ;;
  *) echo "usage: scripts/start.sh [up|down|logs]" >&2; exit 2 ;;
esac

# .env is NOT sourced as shell (it is data, not code): `docker compose
# --env-file` reads it, and scripts/start-check.mjs --get reads single values.
# A variable set in the shell wins over .env, as with compose itself.
ENV_ARGS=()
[ -f .env ] && ENV_ARGS=(--env-file .env)

# Same absolute path inside the local-control container and on the host
# (compose path identity, docs/START.md).
export OPENCLAW_HOST_DOCKER_DIR="$PWD/apps/openclaw-docker-config/docker"

COMPOSE=(docker compose "${ENV_ARGS[@]}"
  -f apps/convex/docker/docker-compose.yml
  -f docker-compose.yml
  -f docker-compose.start.yml)

# `down` / `logs` need neither a valid .env nor the pre-flight: they only need
# compose to interpolate the file, so unset required values get a placeholder.
case "$ACTION" in
  down | logs)
    export OPENCLAW_IMAGE_REGISTRY="${OPENCLAW_IMAGE_REGISTRY:-unset}"
    export OPENCLAW_START_CONTROL_SECRET="${OPENCLAW_START_CONTROL_SECRET:-unset}"
    if [ "$ACTION" = down ]; then exec "${COMPOSE[@]}" down; fi
    exec "${COMPOSE[@]}" logs -f --tail 100
    ;;
esac

node scripts/start-check.mjs

if ! docker info >/dev/null 2>&1; then
  echo "pnpm start needs Docker running (docker info failed)." >&2
  exit 1
fi

cat <<'NOTICE'

  NOTICE: openclaw-local-control runs as a container with the Docker socket
  (/var/run/docker.sock) mounted. That is root-equivalent power over this
  machine. It is required because it creates, restarts and deletes the
  containers of every Project. Fine on a machine you own; do not expose this
  stack to untrusted users. Details and alternatives: docs/START.md

NOTICE

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d

DASHBOARD_URL_VALUE="$(node scripts/start-check.mjs --get DASHBOARD_URL)"
DASHBOARD_PORT_VALUE="$(node scripts/start-check.mjs --get DASHBOARD_PORT)"
echo
echo "Dashboard: ${DASHBOARD_URL_VALUE:-http://localhost:${DASHBOARD_PORT_VALUE:-3912}}"
echo "Logs:      pnpm start:logs      Stop: pnpm start:down"
