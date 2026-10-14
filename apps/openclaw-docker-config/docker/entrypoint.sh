#!/usr/bin/env bash
set -euo pipefail

# Self-host (issue #265/#266): OPENCLAW_GATEWAY_TOKEN is normally a secret
# the operator generates by hand (openssl rand -hex 32). The OSS
# single-instance stack instead generates it once via a sibling bootstrap
# container and persists it to a shared volume — load it here if the
# environment didn't already provide it directly.
if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" && -n "${OPENCLAW_SECRETS_FILE:-}" && -s "${OPENCLAW_SECRETS_FILE:-}" ]]; then
  echo "[entrypoint] loading generated gateway token from $OPENCLAW_SECRETS_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$OPENCLAW_SECRETS_FILE"
  set +a
fi

MANIFEST="/opt/config/skills-manifest.txt"
WORKDIR="/home/node/.openclaw/workspace"
CONFIG_JSON="/home/node/.openclaw/openclaw.json"
DEFAULT_CONFIG_DIR="/opt/config"
CONTROL_SOCKET_PATH="${OPENCLAW_CONTROL_SOCKET_PATH:-/home/node/.openclaw/runtime/control.sock}"
BOOTSTRAP_STAMP="/home/node/.openclaw/bootstrap-complete"

###############################################################################
# Seed default config for local/dev runs when the mounted config dir is empty.
###############################################################################
if [[ -d "$DEFAULT_CONFIG_DIR" ]]; then
  mkdir -p "/home/node/.openclaw"
  cp -rn "$DEFAULT_CONFIG_DIR"/. "/home/node/.openclaw"/
fi

###############################################################################
# Run a one-time minimal bootstrap so the container has workspace/config basics
# without entering the interactive onboarding wizard during OAuth.
###############################################################################
bootstrap_runtime() {
  if [[ -f "$BOOTSTRAP_STAMP" ]] && [[ -f "$CONFIG_JSON" ]]; then
    return
  fi

  if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
    echo "[entrypoint] ERROR: OPENCLAW_GATEWAY_TOKEN is required for bootstrap" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$BOOTSTRAP_STAMP")"
  echo "[entrypoint] Running minimal OpenClaw bootstrap ..."
  if openclaw onboard \
    --non-interactive \
    --mode local \
    --flow quickstart \
    --auth-choice skip \
    --gateway-auth token \
    --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN \
    --accept-risk \
    --skip-health; then
    touch "$BOOTSTRAP_STAMP"
    echo "[entrypoint] Minimal bootstrap complete."
  else
    echo "[entrypoint] ERROR: minimal bootstrap failed" >&2
    exit 1
  fi
}

bootstrap_runtime

###############################################################################
# Optional plugins (Codex, WhatsApp, Xiaomi, Groq): installed only when listed
# in OPENCLAW_OPTIONAL_PLUGINS, uninstalled when they leave the list (#638,
# #639). The image ships none of them.
# Runs before the Gateway starts, so no restart is needed.
###############################################################################
echo "[entrypoint] Reconciling optional OpenClaw plugins (${OPENCLAW_OPTIONAL_PLUGINS:-none}) ..."
node /opt/openclaw-control/optional-plugins.js

###############################################################################
# Enforce config invariants on every start. The seed above is no-clobber, so
# volumes created before a default existed never receive it.
#  - heartbeat off: OpenClaw heartbeat polls run their own model turns and
#    leak into mission sessions.
#  - no agents.defaults.models: a leftover allowlist entry (e.g. mimo-v2.5
#    from an earlier Xiaomi setup) makes runs request that model instead of
#    agents.defaults.model.primary, so only the active Provider must apply.
###############################################################################
echo "[entrypoint] Enforcing config invariants ..."
openclaw config set --json agents.defaults.heartbeat.every '"0m"' \
  || echo "[entrypoint] WARNING: failed to disable heartbeat — continuing"
openclaw config unset agents.defaults.models \
  || echo "[entrypoint] WARNING: failed to unset agents.defaults.models — continuing"

###############################################################################
# Seed workspace templates (no-clobber — won't overwrite existing files)
###############################################################################
TEMPLATES="/opt/workspace-templates"
if [[ -d "$TEMPLATES" ]]; then
  echo "[entrypoint] Seeding workspace templates ..."
  cp -rn "$TEMPLATES"/. "$WORKDIR"/
fi

###############################################################################
# Install ClawHub skills from the manifest (if present)
###############################################################################
if [[ -f "$MANIFEST" ]]; then
  echo "[entrypoint] Installing ClawHub skills from manifest ..."
  while IFS= read -r line; do
    # Skip blank lines and comments
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue

    # Skip if already installed
    if [[ -d "$WORKDIR/skills/$line" ]]; then
      echo "[entrypoint]   ✓ $line (already installed)"
      continue
    fi

    echo "[entrypoint]   → installing $line"
    clawhub install "$line" --workdir "$WORKDIR" || {
      echo "[entrypoint] WARNING: Failed to install $line — continuing"
    }
  done < "$MANIFEST"
  echo "[entrypoint] Skill installation complete."
else
  echo "[entrypoint] No skills manifest found — skipping skill install."
fi

###############################################################################
# Start the local control socket used by the runtime-worker.
###############################################################################
mkdir -p "$(dirname "$CONTROL_SOCKET_PATH")"
node /opt/openclaw-control/socket-server.js &
control_socket_pid=$!

for _ in $(seq 1 50); do
  if [[ -S "$CONTROL_SOCKET_PATH" ]]; then
    break
  fi
  if ! kill -0 "$control_socket_pid" 2>/dev/null; then
    echo "[entrypoint] ERROR: control socket server exited before creating $CONTROL_SOCKET_PATH" >&2
    wait "$control_socket_pid" || true
    exit 1
  fi
  sleep 0.1
done

if [[ ! -S "$CONTROL_SOCKET_PATH" ]]; then
  echo "[entrypoint] ERROR: control socket was not created at $CONTROL_SOCKET_PATH" >&2
  kill "$control_socket_pid" 2>/dev/null || true
  wait "$control_socket_pid" 2>/dev/null || true
  exit 1
fi

cleanup() {
  kill "$control_socket_pid" 2>/dev/null || true
  if [[ -n "${gateway_pid:-}" ]]; then
    kill "$gateway_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

###############################################################################
# Hand off to the real command (CMD from docker-compose) while keeping the
# control socket process alive in the same container.
###############################################################################
"$@" &
gateway_pid=$!

wait "$gateway_pid"
gateway_status=$?
cleanup
wait "$control_socket_pid" 2>/dev/null || true
exit "$gateway_status"
