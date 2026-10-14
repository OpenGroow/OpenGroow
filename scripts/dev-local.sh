#!/usr/bin/env bash
# `pnpm dev` entry point : Convex et Dashboard sur l'hôte, broker et
# openclaw-connect dans Docker.
#
# - Convex : `npx convex dev` (déploiement local anonyme, comme dans les autres
#   projets) au lieu des services Docker convex-*. Le tableau de bord se lance avec
#   `npx convex dashboard`.
# - Dashboard : `next dev` (port 3912).
# - Docker : broker (openclaw-local-control le pilote par `docker cp` sur
#   `opengroow-broker-1`) et openclaw-connect, via docker-compose.local-convex.yml.
#
# openclaw-local-control est lancé en arrière-plan (scripts/local-control-supervisor.mjs),
# une fois le broker démarré.
# Ctrl-C arrête Convex, le Dashboard et openclaw-local-control ; `pnpm dev:down` arrête le broker et
# openclaw-connect. Tout dans Docker (conditions prod, `watch`) : `pnpm dev:docker`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

COMPOSE=(docker compose --env-file .env
  -f apps/convex/docker/docker-compose.yml
  -f docker-compose.yml
  -f docker-compose.local-convex.yml)

# --- 1. Secrets broker<->Convex (générés une fois, persistés dans un volume) ---
"${COMPOSE[@]}" run --rm --no-deps broker-secrets-bootstrap >/dev/null
SECRETS=$("${COMPOSE[@]}" run --rm --no-deps --entrypoint cat broker-secrets-bootstrap /secrets/broker-secrets.env)
secret() { printf '%s\n' "$SECRETS" | sed -n "s/^$1=//p"; }

# --- 2. Convex local (en arrière-plan) ---
trap 'kill 0' EXIT INT TERM
# Une base locale volumineuse démarre en plus de 30 s (défaut du CLI).
export CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS="${CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS:-180}"
npx convex dev --tail-logs disable &

# Le déploiement local vit dans .convex/local/default (config.json : ports, clé d'admin).
# On attend que `convex dev` l'ait créé et que le backend réponde.
CONFIG=".convex/local/default/config.json"
cfg() { node -e 'const c=require(process.argv[1]);process.stdout.write(String(eval("c."+process.argv[2])))' "$PWD/$CONFIG" "$1"; }
CONVEX_URL_LOCAL=""
for _ in $(seq 1 120); do
  if [ -s "$CONFIG" ]; then
    CONVEX_PORT_LOCAL=$(cfg ports.cloud)
    CONVEX_URL_LOCAL="http://127.0.0.1:${CONVEX_PORT_LOCAL}"
    curl -sf -m2 "${CONVEX_URL_LOCAL}/version" >/dev/null && break
  fi
  sleep 1
done
if ! curl -sf -m2 "${CONVEX_URL_LOCAL:-http://127.0.0.1:0}/version" >/dev/null; then
  echo "Convex local ne répond pas (voir la sortie de \`npx convex dev\` ci-dessus)." >&2
  exit 1
fi
CONVEX_SITE_URL_LOCAL="http://127.0.0.1:$(cfg ports.site)"

# --- 3. Variables d'environnement du déploiement (ex-bootstrap) ---
ENV_FILE=$(mktemp)
cat > "$ENV_FILE" <<ENVEOF
DASHBOARD_URL=${DASHBOARD_URL:-http://localhost:3912}
BROKER_URL=http://127.0.0.1:${BROKER_HOST_PORT:-4300}
BROKER_KEY_ID=$(secret BROKER_KEY_ID)
BROKER_SECRET=$(secret BROKER_SECRET)
OPENCLAW_CONTROL_URL=http://localhost:${OPENCLAW_LOCAL_CONTROL_PORT:-4610}
OPENCLAW_LOCAL_CONTROL_URL=http://localhost:${OPENCLAW_LOCAL_CONTROL_PORT:-4610}
BROKER_ADMIN_TOKEN=$(secret BROKER_ADMIN_TOKEN)
OPENCLAW_CONTROL_KEY_ID=${OPENCLAW_CONTROL_KEY_ID:-convex}
OPENCLAW_CONTROL_SECRET=${OPENCLAW_CONTROL_SECRET:-convex-secret}
OPENCLAW_CONTROL_FETCH_TIMEOUT_MS=${OPENCLAW_CONTROL_FETCH_TIMEOUT_MS:-120000}
BETTER_AUTH_SECRET=$(secret BETTER_AUTH_SECRET)
INSTANCE_PROVISIONER=${INSTANCE_PROVISIONER:-local}
IS_SELF_HOST=${IS_SELF_HOST:-1}
OPENCLAW_CONNECT_PUBLIC_BASE_URL=${OPENCLAW_CONNECT_PUBLIC_BASE_URL:-http://localhost:4700}
OPENCLAW_CONNECT_TICKET_TTL_MS=${OPENCLAW_CONNECT_TICKET_TTL_MS:-1800000}
OPENCLAW_OPTIONAL_PLUGINS=${OPENCLAW_OPTIONAL_PLUGINS:-}
ENVEOF
npx convex env set --from-file "$ENV_FILE" --force
rm -f "$ENV_FILE"

# Le premier push échoue tant que ces variables manquent, et `convex dev` ne
# repousse pas quand seules les variables changent : on touche le schéma pour
# relancer le push, puis on applique les migrations en attente (comme le
# bootstrap) dès que les fonctions sont déployées.
touch apps/convex/schema.ts
for i in $(seq 1 60); do
  if npx convex run migrations:runAll '{}' >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = 60 ]; then
    echo "Les fonctions Convex ne se déploient pas (voir la sortie de \`npx convex dev\`)." >&2
    exit 1
  fi
  sleep 2
done

# --- 4. broker + openclaw-connect dans Docker, face à Convex sur l'hôte ---
CONVEX_TOKEN=$(cfg adminKey)
export CONVEX_TOKEN
export CONVEX_DOCKER_URL="http://host.docker.internal:${CONVEX_PORT_LOCAL}"
"${COMPOSE[@]}" up -d --build broker openclaw-connect

# openclaw-local-control (crée les Projects) en arrière-plan, arrêté avec le
# reste par le trap ci-dessus. Lancé APRÈS le broker : au démarrage il
# resynchronise les clés des Instances existantes dans le conteneur du broker
# (`docker cp`), qui doit donc exister. Réutilise une instance déjà à l'écoute.
node scripts/local-control-supervisor.mjs &

echo
echo "Dashboard: ${DASHBOARD_URL:-http://localhost:3912}"
echo "Convex:    ${CONVEX_URL_LOCAL}  (npx convex dashboard)"
echo

# --- 5. Dashboard sur l'hôte ---
cd apps/dashboard
export NODE_ENV=development
export PUBLIC_CONVEX_URL="$CONVEX_URL_LOCAL"
export PUBLIC_APP_URL="${DASHBOARD_URL:-http://localhost:3912}"
export PUBLIC_SEO_MCP_URL="${NEXT_PUBLIC_SEO_MCP_URL:-http://127.0.0.1:3500}"
export CONVEX_URL="$CONVEX_URL_LOCAL"
export CONVEX_SITE_URL="$CONVEX_SITE_URL_LOCAL"
export BROKER_HEALTH_URL="http://127.0.0.1:${BROKER_HOST_PORT:-4300}/health"
export OPENCLAW_CONNECT_INTERNAL_URL="http://127.0.0.1:${OPENCLAW_CONNECT_PORT:-4700}"
export IS_SELF_HOST="${IS_SELF_HOST:-1}"
pnpm dev
