#!/bin/sh
set -eu

# Self-host (issue #265): OPENCLAW_KEY_ID/SECRET/INSTANCE_ID are normally
# generated per-instance by the control-plane for remote deployments and
# passed in directly via the compose environment. The OSS single-instance
# stack has no such control plane, so a bootstrap sibling container
# generates these once and persists them to a shared volume; load them here
# if the environment didn't already provide them.
# shellcheck disable=SC1091
. /opt/runtime-worker/load-secrets-file.sh
load_secrets_file_if_unset OPENCLAW_KEY_ID OPENCLAW_SECRETS_FILE

gateway_host="${OPENCLAW_GATEWAY_UPSTREAM_HOST:-openclaw-gateway}"
gateway_port="${OPENCLAW_GATEWAY_UPSTREAM_PORT:-${OPENCLAW_GATEWAY_PORT:-18789}}"
local_port="${OPENCLAW_GATEWAY_LOCAL_PORT:-${OPENCLAW_GATEWAY_PORT:-18789}}"

echo "[runtime-worker] forwarding 127.0.0.1:${local_port} -> ${gateway_host}:${gateway_port}"
socat "TCP-LISTEN:${local_port},bind=127.0.0.1,fork,reuseaddr" "TCP:${gateway_host}:${gateway_port}" &
socat_pid=$!

cleanup() {
  kill "$socat_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

/opt/runtime-worker/node_modules/.bin/tsx /opt/runtime-worker/src/index.ts &
worker_pid=$!

wait "$worker_pid"
worker_status=$?
cleanup
wait "$socat_pid" 2>/dev/null || true
exit "$worker_status"
