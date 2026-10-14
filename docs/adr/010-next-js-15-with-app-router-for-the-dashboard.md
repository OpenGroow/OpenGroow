# ADR-010: Next.js 15 with App Router for the dashboard

**Status:** Accepted

### Context

The dashboard is the main interface used by non-technical marketing profiles to configure agents, launch missions, and review results. It needs to be responsive, reliable, and fast to develop.

### Options considered

- Remix
- SPA Vite + React (no SSR)
- SvelteKit
- Next.js 15 App Router

### Decision

**Next.js 15 with App Router.**

**Reasons:**

1. **Ecosystem and maturity** — Next.js is the de facto standard for complex React apps. The associated tooling (shadcn/ui, Tailwind, Convex React client) is designed and tested with Next.js as the priority target.
2. **Convention the team already masters** — a pragmatic productivity choice: the team is comfortable with Next.js, which reduces the learning curve and integration mistakes.

### Consequences

- The dashboard (`apps/dashboard`) is a Next.js 15 App Router project with React 19.
- Server Components are available but the dashboard is mostly client-side (Convex subscriptions = React hooks).
- Node-only imports (from shared packages) must be avoided in the dashboard bundle — see `docs/CONVEX.md` for the Node/browser split convention.
