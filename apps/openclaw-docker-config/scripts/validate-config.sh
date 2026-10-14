#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_ROOT/config/openclaw.json"

echo "Validating $CONFIG ..."

# 1. Check valid JSON
if ! jq empty "$CONFIG" 2>/dev/null; then
  echo "ERROR: $CONFIG is not valid JSON"
  exit 1
fi

# 2. Check for raw API key patterns that should never appear in config
PATTERNS='sk-ant-|sk-proj-|bot[0-9]|bsc_|xai-|gsk_'
if grep -qE "$PATTERNS" "$CONFIG"; then
  echo "ERROR: Raw API key pattern detected in $CONFIG"
  echo "Use \${ENV_VAR} references instead of plaintext keys."
  grep -nE "$PATTERNS" "$CONFIG"
  exit 1
fi

echo "✓ Config validation passed"

# 3. Guard against config keys that are not supported by the pinned OpenClaw build.
# `gateway.tools` was removed in an earlier cleanup; keep blocking it in case it reappears.
# `mcp` at the root level is valid from 2026.3.22 onward (current pin).
if jq -e '.gateway? | type == "object" and has("tools")' "$CONFIG" >/dev/null; then
  echo "ERROR: $CONFIG contains gateway.tools, which is not supported"
  echo "Move tool policy out of .gateway."
  exit 1
fi

echo "✓ OpenClaw schema guard passed"
