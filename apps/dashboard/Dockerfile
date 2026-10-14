# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps

WORKDIR /app
# Install the pinned package manager as a real global package. Corepack's
# cached pnpm payload can be materialized as zero-byte files in the dev image
# on Docker Desktop, which makes `pnpm dev` exit cleanly and leaves the
# dashboard container in an endless restart loop.
RUN npm install --global pnpm@11.9.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/hmac/package.json packages/hmac/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/agent-templates/package.json packages/agent-templates/package.json
COPY packages/reliability/package.json packages/reliability/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/convex/package.json apps/convex/package.json

# The dashboard imports Convex's generated types via the "@convex/_generated/*"
# path alias (apps/dashboard/tsconfig.json). api.d.ts itself re-exports types
# from the actual function modules (e.g. `import type * as missions from
# "../missions.js"`), so apps/convex's own dependencies (@convex-dev/*, etc.)
# must be installed too, not just apps/dashboard's — otherwise TypeScript
# silently widens those unresolvable imports to `any`, breaking the
# production type check.
RUN --mount=type=cache,id=opengroow-pnpm-store,target=/pnpm/store --mount=type=cache,id=opengroow-pnpm-cache,target=/pnpm/cache \
    pnpm_config_store_dir=/pnpm/store pnpm_config_cache_dir=/pnpm/cache \
    pnpm install --filter @opengroow/dashboard... --filter @opengroow/convex-app...

COPY packages/hmac packages/hmac
COPY packages/protocol packages/protocol
COPY packages/agent-templates packages/agent-templates
COPY packages/reliability packages/reliability
COPY apps/dashboard apps/dashboard
COPY apps/convex apps/convex

# Dev-mode target (issue #302): stops right after `pnpm install` and the
# source COPY above, before the production build below — docker-compose.dev.yml
# builds this target and runs `next dev` instead, with `docker compose watch`
# syncing further local edits into these same COPY'd paths (no bind mount, so
# the pnpm-installed node_modules above are never shadowed).
FROM deps AS dev

WORKDIR /app/apps/dashboard
ENV NODE_ENV=development
EXPOSE 3912
CMD ["pnpm", "dev"]

FROM deps AS build

WORKDIR /app/apps/dashboard

# No URL-dependent build argument: the dashboard reads its public URLs
# (PUBLIC_CONVEX_URL, PUBLIC_APP_URL, PUBLIC_SEO_MCP_URL) from the container
# environment at request time, so one image serves any domain.
ENV NODE_ENV=production

RUN pnpm build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3912
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public

EXPOSE 3912
CMD ["node", "apps/dashboard/server.js"]
