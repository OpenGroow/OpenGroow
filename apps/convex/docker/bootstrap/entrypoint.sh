#!/bin/sh
set -eu

KEY_FILE=${ADMIN_KEY_FILE:-/convex/data/opengroow-admin-key}

if [ ! -s "$KEY_FILE" ]; then
  echo "Bootstrap error: no admin key found at $KEY_FILE." >&2
  echo "The convex-admin-key service must complete successfully before convex-bootstrap runs." >&2
  exit 1
fi

export CONVEX_SELF_HOSTED_ADMIN_KEY
CONVEX_SELF_HOSTED_ADMIN_KEY=$(cat "$KEY_FILE")

# shellcheck disable=SC1091
. /app/scripts/docker/load-secrets-file.sh

# The unified compose stack (issue #266) generates a real broker<->Convex
# HMAC secret and BETTER_AUTH_SECRET once and persists them to a shared
# volume; load them here if the environment didn't already provide
# BROKER_KEY_ID/BROKER_SECRET directly.
load_secrets_file_if_unset BROKER_KEY_ID BROKER_SECRETS_FILE

# OpenGroow's Convex functions read these via apps/convex/env.ts's required()
# helper, evaluated eagerly (http.ts -> auth.ts -> createAuth()) when Convex
# analyzes the pushed modules — so they must exist on the deployment itself
# (`convex env set`, stored server-side) before `deploy` can even bundle
# the functions, regardless of container-level env vars. The unified compose
# stack (#266) overrides these via this container's own environment (e.g.
# real broker HMAC secrets from #265); standalone, the fallbacks below are
# placeholders good enough to let the schema/functions push succeed.
ENV_DEFAULTS_FILE=$(mktemp)
trap 'rm -f "$ENV_DEFAULTS_FILE"' EXIT
cat > "$ENV_DEFAULTS_FILE" <<EOF
DASHBOARD_URL=${DASHBOARD_URL:-http://localhost:3912}
BROKER_URL=${BROKER_URL:-http://localhost:4300}
BROKER_KEY_ID=${BROKER_KEY_ID:-self-host-placeholder}
BROKER_SECRET=${BROKER_SECRET:-self-host-placeholder-secret}
OPENCLAW_CONTROL_URL=${OPENCLAW_CONTROL_URL:-http://localhost:4610}
OPENCLAW_CONTROL_KEY_ID=${OPENCLAW_CONTROL_KEY_ID:-convex}
OPENCLAW_CONTROL_SECRET=${OPENCLAW_CONTROL_SECRET:-convex-secret}
OPENCLAW_CONTROL_FETCH_TIMEOUT_MS=${OPENCLAW_CONTROL_FETCH_TIMEOUT_MS:-120000}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-self-host-placeholder-better-auth-secret}
INSTANCE_PROVISIONER=${INSTANCE_PROVISIONER:-local}
IS_SELF_HOST=${IS_SELF_HOST:-1}
OPENCLAW_CONNECT_PUBLIC_BASE_URL=${OPENCLAW_CONNECT_PUBLIC_BASE_URL:-http://localhost:4700}
OPENCLAW_CONNECT_TICKET_TTL_MS=${OPENCLAW_CONNECT_TICKET_TTL_MS:-1800000}
OPENCLAW_OPTIONAL_PLUGINS=${OPENCLAW_OPTIONAL_PLUGINS:-}
EOF

echo "Ensuring required Convex deployment environment variables are set..."
if ! convex env set --from-file "$ENV_DEFAULTS_FILE" --force; then
  echo "Bootstrap error: 'convex env set' failed (see output above)." >&2
  exit 1
fi

echo "Deploying OpenGroow's Convex schema/functions to ${CONVEX_SELF_HOSTED_URL:-<unset>}..."

# `deploy` only accepts CONVEX_SELF_HOSTED_URL/CONVEX_SELF_HOSTED_ADMIN_KEY as
# env vars, not --admin-key/--url flags (verified against the installed CLI;
# those flags don't exist) — despite issue #264's text suggesting flags.
if ! convex deploy; then
  echo "Bootstrap error: 'convex deploy' failed (see output above)." >&2
  echo "Fix the reported error and re-run 'docker compose up' — the backend is unaffected until this step succeeds." >&2
  exit 1
fi

echo "Convex deploy complete."

# Self-hosters never run migration commands themselves (issue #267): any
# pending @convex-dev/migrations entries a OpenGroow developer added to
# migrations.ts's runAll list are applied right here, right after deploy and
# before the rest of the stack (broker, openclaw, dashboard) starts —
# `runAll` is a no-op when its list is empty or already fully applied, so
# this is safe to run on every bootstrap.
echo "Running pending schema migrations..."
if ! convex run migrations:runAll '{}'; then
  echo "Bootstrap error: 'convex run migrations:runAll' failed (see output above)." >&2
  exit 1
fi

echo "Migrations complete."
