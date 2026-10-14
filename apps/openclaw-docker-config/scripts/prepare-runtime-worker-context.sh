#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONOREPO_ROOT="$(cd "$REPO_ROOT/../.." && pwd)"
CONTEXT_DIR="${1:-}"

if [[ -z "$CONTEXT_DIR" ]]; then
  echo "Usage: $0 <context-dir>" >&2
  exit 1
fi

mkdir -p \
  "$CONTEXT_DIR/apps/openclaw-docker-config/docker/runtime-worker" \
  "$CONTEXT_DIR/apps/openclaw-runtime-worker" \
  "$CONTEXT_DIR/scripts/docker" \
  "$CONTEXT_DIR/packages"

cp "$REPO_ROOT/OPENCLAW_VERSION" \
  "$CONTEXT_DIR/apps/openclaw-docker-config/OPENCLAW_VERSION"
cp "$REPO_ROOT/docker/runtime-worker/Dockerfile" \
  "$CONTEXT_DIR/apps/openclaw-docker-config/docker/runtime-worker/Dockerfile"
cp "$REPO_ROOT/docker/runtime-worker/entrypoint.sh" \
  "$CONTEXT_DIR/apps/openclaw-docker-config/docker/runtime-worker/entrypoint.sh"
cp "$MONOREPO_ROOT/scripts/docker/load-secrets-file.sh" \
  "$CONTEXT_DIR/scripts/docker/load-secrets-file.sh"
cp -R "$MONOREPO_ROOT/apps/openclaw-runtime-worker/src" \
  "$CONTEXT_DIR/apps/openclaw-runtime-worker/src"
cp -R "$MONOREPO_ROOT/packages/hmac" \
  "$CONTEXT_DIR/packages/hmac"
cp -R "$MONOREPO_ROOT/packages/protocol" \
  "$CONTEXT_DIR/packages/protocol"
