# ADR-011: Turborepo + pnpm workspaces

**Status:** Accepted

### Context

Megaclaw groups several apps and packages that share code (protocol types, HMAC, templates). We need a monorepo system that can build, test, and deploy each app independently while sharing common dependencies.

### Options considered

- Nx
- Lerna + npm/yarn workspaces
- Separate repos
- Turborepo + pnpm workspaces

### Decision

**Turborepo + pnpm workspaces.**

**Reasons (combined):**

1. **Turborepo build cache** — build outputs are cached locally (and potentially in a remote cache). Only the apps and packages affected by a change are rebuilt — fast incremental builds in CI.
2. **pnpm: no phantom dependencies** — pnpm doesn't hoist transitive dependencies by default. Each package can only import what it explicitly declares, which avoids silent npm/yarn hoisting bugs.
3. **Simplicity vs. Nx** — Turborepo has a minimal configuration (`turbo.json` + `pipeline`) sufficient for this monorepo. Nx offers more features but imposes a structure and configuration complexity that isn't justified at this stage.

### Consequences

- Inter-package dependencies are declared in `pnpm-workspace.yaml` and the respective `package.json` files.
- The Turborepo pipeline (`turbo.json`) defines the order of tasks (`build`, `dev`, `typecheck`) and their dependencies between packages.
- `pnpm install` at the root installs all dependencies for all packages using a centralized store (disk space savings).
- Adding a new app or package requires referencing it in `pnpm-workspace.yaml` and adding its scripts to `turbo.json` if needed.
