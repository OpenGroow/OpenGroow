#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# OPENCLAW_IMAGE_REGISTRY must be set: the registry path images are published
# under, e.g. registry.example.com/<team>. No default.
if [[ -z "${OPENCLAW_IMAGE_REGISTRY:-}" ]]; then
    echo "ERROR: OPENCLAW_IMAGE_REGISTRY environment variable is not set" >&2
    echo "Example: OPENCLAW_IMAGE_REGISTRY=registry.example.com/<team>  (set it in the root .env or your shell)" >&2
    exit 1
fi

IMAGE_PREFIX="${OPENCLAW_IMAGE_REGISTRY%/}"
TAG="${1:-latest}"
SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD)

echo "==> Validating config ..."
"$REPO_ROOT/scripts/validate-config.sh"
echo ""
"$REPO_ROOT/scripts/check-secrets.sh"
echo ""

# --- Gateway image ---
GW_IMAGE="$IMAGE_PREFIX/openclaw-gateway"
echo "==> Building gateway image ..."
echo "    Image: $GW_IMAGE"
echo "    Tags:  $TAG, $SHA"
echo ""

docker buildx build --platform linux/amd64 -f "$REPO_ROOT/docker/Dockerfile" -t "$GW_IMAGE:$TAG" -t "$GW_IMAGE:$SHA" --push "$REPO_ROOT"

echo ""
echo "✓ Built and pushed $GW_IMAGE:$TAG (linux/amd64)"
echo "✓ Built and pushed $GW_IMAGE:$SHA (linux/amd64)"

# --- Runtime-worker image ---
RW_IMAGE="$IMAGE_PREFIX/openclaw-runtime-worker"
echo ""
echo "==> Building runtime-worker image ..."
echo "    Image: $RW_IMAGE"
echo "    Tags:  $TAG, $SHA"
echo ""

BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-runtime-worker-build.XXXXXX")"
trap 'rm -rf "$BUILD_CONTEXT"' EXIT
"$REPO_ROOT/scripts/prepare-runtime-worker-context.sh" "$BUILD_CONTEXT"

docker buildx build --platform linux/amd64 -f "$BUILD_CONTEXT/apps/openclaw-docker-config/docker/runtime-worker/Dockerfile" -t "$RW_IMAGE:$TAG" -t "$RW_IMAGE:$SHA" --push "$BUILD_CONTEXT"

echo ""
echo "✓ Built and pushed $RW_IMAGE:$TAG (linux/amd64)"
echo "✓ Built and pushed $RW_IMAGE:$SHA (linux/amd64)"
