# ADR-057: Official Templates are installed from the hub on demand; only `@opengroow/source` is bootstrapped, from a pinned release

*Follow-up to ADR-054 and ADR-056 (#673, spec #710 phase 1).*

### Context

With the Template registry (ADR-054), the built-in Templates compiled into Megaclaw are a transitional fallback (#674 removes it). A new Project must be able to add every official Template without them.

### Decision

- Official Templates are installed from the hub when a user adds them (Add Agent). Nothing official is seeded into a deployment.
- Exception: `@opengroow/source`, the system Agent that judges and routes the Sources of every Project. It is installed when a Project is created (`instances.createLocalInstance`, and `saveJob` the first time the job carries the OpenClaw id), by `source_bootstrap_node.bootstrap`, scheduled after the commit.
- Its release (repository, tag, asset, **digest**) is a constant of the product (`PINNED_SOURCE_RELEASE`), not read from the hub index: an edited or compromised index cannot substitute the package. Bumping the version is a reviewed code change; existing Projects get it through the update plan (#669), not automatically.
- An unreachable hub never blocks creating a Project: the install is retried (1 min, 10 min, 1 h, 6 h), then logged. `pnpm template:migrate-builtin` re-runs it for any Project missing it.
- Templates that are not on the hub (the private ones) are installed from a local folder with `template:add`, which is also the offline bootstrap of a self-host stack.
- Projects that run a Template through the `"builtin"` fallback are migrated by `pnpm template:migrate-builtin <packages-dir>`: it asks Convex which (Project, Template) pairs have no installed version and installs them (Source from the hub, the others from the folder). It is idempotent and must complete before #674.

### Consequences

- Until the first `@opengroow/source` release exists, `PINNED_SOURCE_RELEASE.digest` is empty, the bootstrap is refused (and logged) and `pinned-source.test.ts` fails on purpose.
