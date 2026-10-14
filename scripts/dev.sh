#!/usr/bin/env bash
# `pnpm dev` entry point: prints the dashboard URL before handing off to
# `docker compose watch`, which otherwise only logs container/build events —
# nothing tells you where to actually look once the stack is up.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

echo "Dashboard: ${DASHBOARD_URL:-http://localhost:${DASHBOARD_PORT:-3912}}"
echo

exec docker compose --env-file .env \
  -f apps/convex/docker/docker-compose.yml \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  watch
