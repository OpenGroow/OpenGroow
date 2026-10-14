# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/reliability/package.json packages/reliability/package.json
COPY apps/openclaw-connect/package.json apps/openclaw-connect/package.json

RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm install --filter @opengroow/openclaw-connect... --prod

COPY packages/reliability packages/reliability
COPY apps/openclaw-connect apps/openclaw-connect
COPY scripts/docker/load-secrets-file.sh scripts/docker/load-secrets-file.sh

RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm --config.inject-workspace-packages=true --filter @opengroow/openclaw-connect --prod deploy /prod

FROM node:22-bookworm-slim AS base

WORKDIR /app
RUN npm install --global pnpm@11.9.0

COPY --from=build /prod ./
COPY --from=build /app/apps/openclaw-connect/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=build /app/scripts/docker/load-secrets-file.sh ./scripts/docker/load-secrets-file.sh

ENV NODE_ENV=production

RUN chmod +x docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
# docker-entrypoint.sh execs "$@" as its last step — this is that default,
# overridden by docker-compose.dev.yml (issue #302) to run `pnpm dev`
# (tsx watch) instead, for hot-reload without a container restart.
CMD ["node", "--import", "tsx", "src/server.ts"]
