#!/bin/sh
set -eu

# Self-host (issue #266): the unified compose stack generates the
# Convex<->broker HMAC secret once and persists the Convex admin key from
# the convex-bootstrap fragment (issue #264) to a shared volume, rather than
# requiring the operator to copy either into this container's environment by
# hand (a deployment may still set BROKER_CONVEX_KEYS
# and CONVEX_TOKEN directly, which makes both branches below no-ops).
# shellcheck disable=SC1091
. /app/scripts/docker/load-secrets-file.sh

if [ -z "${CONVEX_TOKEN:-}" ] && [ -n "${CONVEX_ADMIN_KEY_FILE:-}" ] && [ -s "$CONVEX_ADMIN_KEY_FILE" ]; then
  echo "[broker] loading Convex admin key from $CONVEX_ADMIN_KEY_FILE"
  CONVEX_TOKEN=$(cat "$CONVEX_ADMIN_KEY_FILE")
  export CONVEX_TOKEN
fi

# Also picks up BROKER_ADMIN_TOKEN and BETTER_AUTH_SECRET (the latter unused
# here, consumed by convex-bootstrap instead) from the same file.
if [ -z "${BROKER_CONVEX_KEYS:-}" ]; then
  load_secrets_file_if_unset BROKER_KEY_ID BROKER_SECRETS_FILE
  if [ -n "${BROKER_KEY_ID:-}" ]; then
    echo "[broker] deriving BROKER_CONVEX_KEYS from generated broker secret"
    BROKER_CONVEX_KEYS="{\"${BROKER_KEY_ID}\":{\"secret\":\"${BROKER_SECRET}\"}}"
    export BROKER_CONVEX_KEYS
  fi
fi

exec "$@"
