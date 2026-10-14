Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

For multi-view interfaces in Next.js, prefer dedicated App Router routes/pages and shared layouts over a single large monolithic client component driven by local view state. If a screen has distinct sections that should be navigable, reloadable, or back-button friendly, model them as routes first.

## Dashboard layout (`apps/dashboard`)

- Next.js 16, React 19, App Router. Dev server: `pnpm --filter @opengroow/dashboard dev` (port 3912, also started by `pnpm dev`).
- Routes live in `app/`. Authenticated pages are under `app/(app)/`, sign-in and sign-up are beside it. Today both `projects/[projectId]/…` and `instances/[instanceId]/…` route trees exist: check which one a page belongs to before adding or moving one.
- `src/components/` holds feature components, `src/hooks/` data hooks, `src/lib/` clients and helpers (`auth-client`, `convex-error`), `src/utils/` pure helpers. `components/ui/` holds the shadcn primitives.
- The dashboard talks only to Convex: `useQuery`, `useMutation` and `useAction` from `convex/react`, with `api` from `@convex/_generated/api`. Authentication goes through Better Auth (`src/lib/auth-client`).
- Import aliases: `@/…` is `apps/dashboard`, `@convex/…` is `apps/convex` (also configured in the root `vitest.config.ts`).
- Mark a file `"use client"` only when it needs hooks or browser APIs.
- Tests: `apps/dashboard/test/*.test.ts(x)`, run from the repo root with `pnpm test`. Typecheck with `pnpm typecheck`.
