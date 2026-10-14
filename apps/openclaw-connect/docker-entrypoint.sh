#!/bin/sh
set -eu

# Self-host (ADR-031): the unified compose stack generates the broker admin
# token and persists the Convex admin key from the convex-bootstrap fragment
# (issue #264) to shared volumes, rather than requiring the operator to copy
# either into this container's environment by hand. Same pattern as
# apps/broker/docker-entrypoint.sh.
# shellcheck disable=SC1091
. /app/scripts/docker/load-secrets-file.sh

if [ -z "${CONVEX_TOKEN:-}" ] && [ -n "${CONVEX_ADMIN_KEY_FILE:-}" ] && [ -s "$CONVEX_ADMIN_KEY_FILE" ]; then
  echo "[openclaw-connect] loading Convex admin key from $CONVEX_ADMIN_KEY_FILE"
  CONVEX_TOKEN=$(cat "$CONVEX_ADMIN_KEY_FILE")
  export CONVEX_TOKEN
fi

load_secrets_file_if_unset BROKER_ADMIN_TOKEN BROKER_SECRETS_FILE

exec "$@"
