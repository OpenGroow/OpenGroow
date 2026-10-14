# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml convex.json tsconfig.base.json ./
COPY packages/hmac/package.json packages/hmac/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/agent-templates/package.json packages/agent-templates/package.json
COPY packages/reliability/package.json packages/reliability/package.json
COPY apps/convex/package.json apps/convex/package.json

RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm install --filter @opengroow/convex-app...

COPY packages/hmac packages/hmac
COPY packages/protocol packages/protocol
COPY packages/agent-templates packages/agent-templates
COPY packages/reliability packages/reliability
COPY apps/convex apps/convex
COPY scripts/docker/load-secrets-file.sh scripts/docker/load-secrets-file.sh
# Not needed to deploy schema/functions, and its tests reference
# apps/fake-openclaw, which isn't copied into this build context.
RUN rm -rf apps/convex/test

RUN node -p "require('./node_modules/convex/package.json').version" > /tmp/convex-version
RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm --config.inject-workspace-packages=true --filter @opengroow/convex-app --prod deploy /prod/convex-app
# Convex walks the configured functions directory to discover entry points.
# Keep the deployed dependencies outside that directory, otherwise every JS
# file under apps/convex/node_modules is treated as a Convex function.
RUN mkdir -p /prod/convex-source \
  && cp -a /prod/convex-app/. /prod/convex-source/ \
  && rm -rf /prod/convex-source/node_modules

FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY --from=build /tmp/convex-version /tmp/convex-version
RUN npm install --global "convex@$(cat /tmp/convex-version)" \
  && rm /tmp/convex-version

COPY --from=build /app/convex.json ./convex.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
# The Convex CLI resolves its project root from package.json. `pnpm deploy`
# only copies the deployed workspace package, so retain this small root
# manifest alongside convex.json in the runtime image.
COPY --from=build /app/package.json ./package.json
COPY --from=build /prod/convex-app/node_modules ./node_modules
COPY --from=build /prod/convex-source ./apps/convex
# `convex` is a devDependency of the app because it is a CLI/framework
# package, but the CLI still needs its `convex/server` export while bundling.
# Re-expose the exact production dependency copy already present in pnpm's
# virtual store; this keeps package resolution inside the deployed tree while
# leaving node_modules outside the configured functions directory.
RUN ln -s /app/node_modules/.pnpm/convex@*/node_modules/convex \
  /app/node_modules/convex

COPY --from=build /app/apps/convex/docker/bootstrap/entrypoint.sh /app/entrypoint.sh
COPY --from=build /app/scripts/docker/load-secrets-file.sh /app/scripts/docker/load-secrets-file.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
