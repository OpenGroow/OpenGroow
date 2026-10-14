#!/usr/bin/env bash
# Convenience for the self-host Docker stack's Convex dashboard
# (ghcr.io/get-convex/convex-dashboard, published on :6791 by
# apps/convex/docker/docker-compose.yml). `npx convex dashboard` can't be
# pointed at it — the CLI explicitly refuses self-hosted deployments — so
# the only way in is this separate dashboard image, which asks for the
# admin key by hand. This just saves the trip to fetch it from the
# convex-backend container. This is what the `convex:dashboard` package.json
# script runs.
set -euo pipefail

PORT="${CONVEX_DASHBOARD_PORT:-6791}"
URL="http://localhost:${PORT}"

# No hard-coded container name: it depends on the Compose project, which is
# `opengroow` unless COMPOSE_PROJECT_NAME overrides it. Resolve the
# convex-backend service by its Compose labels instead.
PROJECT="${COMPOSE_PROJECT_NAME:-opengroow}"
CONTAINER="${CONVEX_BACKEND_CONTAINER:-$(docker ps \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=convex-backend" \
  --format '{{.Names}}' | head -n1)}"

if [ -z "$CONTAINER" ] || ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "No running convex-backend container for the Compose project '${PROJECT}' — is the self-host stack up (docker compose up)?" >&2
  echo "Under another project name, set COMPOSE_PROJECT_NAME (or CONVEX_BACKEND_CONTAINER)." >&2
  exit 1
fi

admin_key="$(docker exec "$CONTAINER" cat /convex/data/opengroow-admin-key)"

echo "Admin key (paste it into the dashboard when asked):"
echo "$admin_key"
echo
echo "Opening $URL ..."

if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  echo "Open it manually: $URL"
fi
