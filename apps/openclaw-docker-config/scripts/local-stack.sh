#!/usr/bin/env bash
set -euo pipefail

# Builds the local-multi gateway/runtime-worker images (the ":local" tag
# openclaw-local-control's dynamically-created per-Project compose stacks
# reference by default — see apps/openclaw-local-control/src/config.ts) and
# rolls the rebuilt image out to every already-running self-host Project, so
# they pick up the change without being deleted and recreated from the
# dashboard. This is the only thing this script does — it does not manage a
# standalone gateway/runtime-worker stack of its own.
#
# Usage: ./apps/openclaw-docker-config/scripts/local-stack.sh
#        OPENCLAW_LOCAL_GATEWAY_IMAGE_TAG=my/gateway:dev ./apps/openclaw-docker-config/scripts/local-stack.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONOREPO_ROOT="$(cd "$REPO_ROOT/../.." && pwd)"
DOCKER_DIR="$REPO_ROOT/docker"

# Same .env as `pnpm dev`: the rollout recreates the instances with whatever
# OPENCLAW_OPTIONAL_PLUGINS it sees, and an empty value uninstalls the plugins
# (ADR-068), so it must not depend on how this script was launched.
if [ -f "$MONOREPO_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a && source "$MONOREPO_ROOT/.env" && set +a
fi
GATEWAY_IMAGE_TAG="${OPENCLAW_LOCAL_GATEWAY_IMAGE_TAG:-opengroow/openclaw-gateway:local}"
WORKER_IMAGE_TAG="${OPENCLAW_LOCAL_RUNTIME_WORKER_IMAGE_TAG:-opengroow/openclaw-runtime-worker:local}"

build_gateway_image() {
  echo "==> Building local gateway image"
  echo "    tag: $GATEWAY_IMAGE_TAG"
  docker build \
    -f "$DOCKER_DIR/Dockerfile" \
    -t "$GATEWAY_IMAGE_TAG" \
    "$REPO_ROOT"
}

build_runtime_worker_image() {
  echo "==> Building local runtime-worker image"
  echo "    tag: $WORKER_IMAGE_TAG"

  local build_context
  build_context="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-runtime-worker-local.XXXXXX")"
  trap 'rm -rf "'"$build_context"'"' RETURN

  "$REPO_ROOT/scripts/prepare-runtime-worker-context.sh" "$build_context"

  docker build \
    -f "$build_context/apps/openclaw-docker-config/docker/runtime-worker/Dockerfile" \
    -t "$WORKER_IMAGE_TAG" \
    "$build_context"
}

run_rollout() {
  # Recreates every existing local-multi instance (openclaw-local-control,
  # one compose project per instance) against the image just retagged above
  # — otherwise those instances keep running the pre-rebuild image until
  # manually deleted and recreated from the dashboard. Best-effort: no
  # instances existing yet is not an error.
  echo "==> Rolling out the rebuilt image to existing local-multi instances"
  (cd "$MONOREPO_ROOT" && pnpm --filter @opengroow/openclaw-local-control rollout) \
    || echo "WARNING: rollout failed — existing local-multi instances may still be running the previous image (check that openclaw-local-control is running)" >&2
}

build_gateway_image
build_runtime_worker_image
run_rollout
