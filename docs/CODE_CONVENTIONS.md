# Code conventions

- When a feature is removed, remove the implementation entirely. Do not keep compatibility wrappers, fallback paths, stub actions, or dead code unless a phased deprecation was explicitly requested.
- Prefer deep modules with small, high-leverage interfaces over oversized source files that directly manage every operational detail. When a file starts accumulating several responsibilities or too much branching, split it by responsibility behind clearer high-level seams instead of growing one orchestration file.
- More generally, avoid oversized source files. When a file grows beyond roughly 300 lines, prefer splitting it by responsibility into smaller modules unless there is a clear reason to keep it intact.

## Layout and naming

- Monorepo managed with pnpm workspaces and Turborepo: `apps/*` are services, `packages/*` are shared libraries (`hmac`, `protocol`, `reliability`, `agent-templates`). Package scope is `@opengroow/*`.
- Convex files in `apps/convex` are `snake_case`. A `_node.ts` suffix marks a Node-only module (`"use node"` actions); keep shared types out of it (see `docs/CONVEX.md`).
- Dashboard files are `kebab-case`; see `docs/NEXTJS.md` and `docs/UI.md`.
- Code, comments, UI text and docs are in English.

## Tests

- Vitest from the repo root: `pnpm test`. Test files are `*.test.ts(x)`.
- Where they live: `apps/<app>/test/`, `packages/*/src/`, and `scripts/`. Convex tests run in the `edge-runtime` environment.
- Run `pnpm typecheck` before pushing.

## Documentation

- Domain terms: use `GLOSSARY.md` and `docs/domain/`; do not invent synonyms.
- Decisions: add a new ADR in `docs/adr/` (one file per decision) instead of rewriting an old one, and check its "Live?" status in `docs/adr/README.md` before relying on it.
- Comments that cite a decision name the ADR number or the issue (`ADR-033`, `issue #455`).
