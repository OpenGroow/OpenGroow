#!/usr/bin/env bash
# Arrête la stack de développement principale ET tous les containers per-projet
# openclaw-* (gateway + runtime-worker) créés par openclaw-local-control.
#
# Usage : pnpm dev:down
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- 1. Stack principale (broker + openclaw-connect) ---
docker compose --env-file .env \
  -f apps/convex/docker/docker-compose.yml \
  -f docker-compose.yml \
  -f docker-compose.local-convex.yml \
  --profile convex-docker \
  down

# --- 2. Containers per-projet openclaw-* (démarrés en mode détaché par
#        openclaw-local-control, pas gérés par la stack principale) ---
#
# Chaque projet obtient un compose project `openclaw-{instanceId}` avec deux
# services : openclaw-gateway et openclaw-runtime-worker.
# On récupère tous les noms de projets depuis les labels Docker en cours
# d'exécution, on filtre ceux qui commencent par "openclaw-", et on les arrête.

_per_project_names=$(
  docker ps \
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
    down 2>/dev/null || true
done <<< "$_per_project_names"
