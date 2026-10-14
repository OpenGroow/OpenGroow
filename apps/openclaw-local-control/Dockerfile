# syntax=docker/dockerfile:1
# openclaw-local-control as a container, for `pnpm start` (#718). It runs
# `docker compose` against the host daemon, so the Docker socket is mounted at
# run time (docker-compose.start.yml, documented in docs/START.md).
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/hmac/package.json packages/hmac/package.json
COPY apps/openclaw-local-control/package.json apps/openclaw-local-control/package.json

RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm install --filter @opengroow/openclaw-local-control... --prod

COPY packages/hmac packages/hmac
COPY apps/openclaw-local-control apps/openclaw-local-control

RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm --config.inject-workspace-packages=true --filter @opengroow/openclaw-local-control --prod deploy /prod

# Docker CLI + Compose plugin only (no daemon): taken from the official CLI image.
FROM docker:27-cli AS docker-cli

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
# tsx runs the TypeScript sources (same as `pnpm start` in the package).
RUN npm install --global tsx@4

COPY --from=build /prod ./

ENV NODE_ENV=production
# The docker.sock is mounted here: refuse the built-in default HMAC key.
ENV OPENCLAW_LOCAL_CONTROL_REQUIRE_KEYS=1
EXPOSE 4610
CMD ["tsx", "src/server.ts"]
