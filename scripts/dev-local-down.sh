#!/usr/bin/env bash
# Arrête la stack de développement principale ET tous les containers per-projet
# openclaw-* (gateway + runtime-worker) créés par openclaw-local-control.
#
# Usage : pnpm dev:down
set -uo pipefail
# Note: `set -e` is intentionally omitted so that a failure in the main stack
# does not skip the per-project container cleanup that follows.

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- 1. Stack principale (broker + openclaw-connect) ---
# Errors are printed but do not abort the script so cleanup continues.
docker compose --env-file .env \
  -f apps/convex/docker/docker-compose.yml \
  -f docker-compose.yml \
  -f docker-compose.local-convex.yml \
  --profile convex-docker \
  down || echo "Warning: main stack 'down' exited with an error (see above)." >&2

# --- 2. Containers per-projet openclaw-* (démarrés en mode détaché par
#        openclaw-local-control, pas gérés par la stack principale) ---
#
# Chaque projet obtient un compose project `openclaw-{instanceId}` avec deux
# services : openclaw-gateway et openclaw-runtime-worker.
# `docker ps -a` inclut les conteneurs arrêtés pour nettoyer les projets dont
# les conteneurs se sont déjà arrêtés tout seuls.

_per_project_names=$(
  docker ps -a \
    --format '{{index .Labels "com.docker.compose.project"}}' \
    2>/dev/null \
  | grep '^openclaw-' \
  | sort -u \
  || true
)

if [ -z "$_per_project_names" ]; then
  exit 0
fi

echo "Arrêt des containers per-projet openclaw..."
while IFS= read -r _project; do
  echo "  stopping: $_project"
  docker compose -p "$_project" \
    -f apps/openclaw-docker-config/docker/docker-compose.yml \
    -f apps/openclaw-docker-config/docker/docker-compose.local.yml \
    down || echo "  Warning: failed to stop $_project" >&2
done <<< "$_per_project_names"
