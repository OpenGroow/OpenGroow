# ADR-064: Global rename megaclaw -> opengroow, with narrow compatibility paths

**Status:** Accepted (#723, parent #710 phase 3). Step-by-step instructions for users: `docs/MIGRATION-RENAME.md`.

## Context

The product is renamed OpenGroow. The rename is done once, in one pass, before the first commit of the public repository. Template ids and the Template scope were renamed earlier (#708). This ADR covers everything else: npm packages, environment variables, Docker image and Compose project names, the machine-side Android CLI name, the profile file name, docs and comments.

Some names persist outside the repository (a paired node's config directory on a user's machine, Compose projects and volumes, snapshots stored in Convex). Each needed a decision.

## Decision

- **Rename everything by default.** `@megaclaw/*` -> `@opengroow/*`; `MEGACLAW_*` and `LC_MEGACLAW_*` -> `OPENGROOW_*` and `LC_OPENGROOW_*`; images `megaclaw/*` and `megaclaw-*` -> `opengroow/*` and `opengroow-*`; Compose project `megaclaw` -> `opengroow` (default broker container `opengroow-broker-1`); the `megaclaw-android` CLI -> `opengroow-android` (Template prompts, hooks, docs); `profiles/megaclaw.yml` -> `profiles/opengroow.yml`.
- **Guard.** `scripts/no-megaclaw-name.test.ts` fails when the old name appears in a tracked file or path, except frozen ADRs, the migration notes, the cut tooling documents, and an explicit allowlist of files that hold a legacy value on purpose.
- **Paired nodes: moved on first use, read in place as a fallback.** The node config directory `~/.openclaw-megaclaw-connect` becomes `~/.openclaw-opengroow-connect`. `resolveStateRoot` (`apps/openclaw-connect/src/state-root.ts`) renames the old directory when the new one is absent (same parent, atomic); if the rename fails it uses the old directory in place, so the node stays paired. When both exist the new one wins and the old one is never touched. No re-pairing is needed.
- **Running local Instances: nothing to adopt.** Instance Compose projects are named `openclaw-<id>` (`PROJECT_PREFIX` in `discover-instances.ts`), never from the product name, and discovery matches containers by service name and project prefix. Existing Instances keep running and are re-discovered. They run the old `megaclaw/openclaw-*` image tags until their next rollout or recreation, which uses the new tags. Only the shared stack changes: Compose project `opengroow` means new container names and new named volumes; `docs/MIGRATION-RENAME.md` gives the two paths (keep `COMPOSE_PROJECT_NAME=megaclaw` to keep the data, or start fresh).
- **Environment variables: no fallback in the code.** The old names are not read anywhere. `pnpm start` pre-flight (`scripts/start-check.mjs`) reads `.env` and the process environment and fails with a message listing each `MEGACLAW_*` variable found and its new name. This prevents the silent failure of a stale `.env` without keeping two names alive across the codebase. Convex deployment variables (`OPENGROOW_HUB_REPOSITORY`, `OPENGROOW_HUB_REF`, `OPENGROOW_ENABLE_DEMO_AGENTS`) must be re-set on the deployment.
- **Stored Template snapshots: read under the new profile name.** Snapshots installed before the rename hold `profiles/megaclaw.yml`. The legacy reader (`storedClawPackageToTemplate`) aliases it to `profiles/opengroow.yml` in memory; stored files are not rewritten, so their digests keep matching. New installs and links require `profiles/opengroow.yml`; a Template package still using the old file name is refused (its profile is reported missing).
- **Wire-level values: none found, none changed.** `packages/hmac` and `packages/protocol` contain no `megaclaw` string beyond their package names (checked with a case-insensitive search of every tracked file, not only a keyword list). Signing inputs, headers and key ids are unchanged. Legacy OpenClaw agent ids derived from the old scope (`megaclaw--seo`, `megaclaw--social-engagement`) are kept where code recognises them in stored data.
- **Kept on purpose.** The legacy scope constant `@megaclaw/` (refusal and in-memory aliasing, #708), the `migrations.ts` rewrite and its tests.

## Alternatives considered

- **Read the old environment variables everywhere**: two names for every setting, forever; rejected. A one-time message at the entry point costs one function.
- **Keep the old node directory name**: no migration, but a permanent legacy name in a public product; rejected for an atomic same-parent rename with an in-place fallback.
- **Rewrite stored snapshots to the new profile name**: breaks digests and Mission version pins; rejected for an in-memory alias.
- **Rename the Compose project by migrating volumes in code**: risky for data, and the user can pin `COMPOSE_PROJECT_NAME`; documented instead.

## Consequences

- A developer upgrading must follow `docs/MIGRATION-RENAME.md` once (variables, stack, Convex deployment variables, images).
- localStorage flags keyed by the old name (the "test validated" marker of an Instance workspace) are not carried over; the user validates again.
- The allowlist in the guard is the inventory of intentional leftovers: removing an entry is how a leftover is retired.
