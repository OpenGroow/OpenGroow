# Project description

OpenGroow is a platform that simplifies creating and managing projects containing agents executed through OpenClaw.

## Package manager

This is a monorepo containing web services and CLI tools.
Use pnpm workspaces to manage dependencies.
See each package's AGENTS.md for specific guidelines.

## Commands

```bash
pnpm install           # install all deps
pnpm dev               # local Convex (npx convex dev) + Dashboard on the host, broker/openclaw-connect in Docker
pnpm dev:down          # stop the Docker containers started by pnpm dev
pnpm dev:docker        # full Docker stack with hot reload (docker compose watch), self-hosted Convex
pnpm typecheck         # typecheck all packages
pnpm test              # run vitest tests
pnpm convex:codegen    # regenerate Convex types (generates apps/convex/_generated) without running dev server
```

For Convex conventions, see docs/CONVEX.md
For Next.js conventions, see docs/NEXTJS.md
For UI conventions, see docs/UI.md
For HMAC conventions, see docs/HMAC.md
For the remote control-plane API contract, see docs/CONTROL_PLANE.md
For Architecture conventions, see docs/ARCHITECTURE.md
For Code conventions, see docs/CODE_CONVENTIONS.md
For Template development (install from a folder, link, hub), see docs/TEMPLATE_DEVELOPMENT.md

### Domain Docs

Single context layout: `GLOSSARY.md` (index) at the repo root, detailed terms under `docs/domain/`, one ADR per file under `docs/adr/` (index in `docs/adr/README.md`). See `docs/agents/domain.md`

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `OpenGroow/OpenGroow`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain layout: root `GLOSSARY.md` (index), `docs/domain/` for detailed terms, one ADR per file under `docs/adr/`. See `docs/agents/domain.md`.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `apps/convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
