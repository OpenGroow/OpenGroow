# OpenClaw native Claw install: can OpenGroow delegate? (research for #642)

Version checked: repo pins OpenClaw 2026.9.1 (`apps/openclaw-docker-config/OPENCLAW_VERSION`). All evidence below comes from the local image `opengroow/openclaw-gateway:local` (`openclaw --version` -> 2026.9.1 ad6fe23): its shipped docs `/usr/local/lib/node_modules/openclaw/docs/cli/claws.md`, `dist/experimental-*.js`, `dist/claws-cli*.js`, and commands run in the container. The host `openclaw` is 2026.7.1-2 and has no `claws` command. Online docs/ClawHub source were not consulted (UNVERIFIED beyond the shipped docs).

## Commands and flag
- Gate: `OPENCLAW_EXPERIMENTAL_CLAWS=1` (or `true`), else error "Claws are experimental and disabled" (`dist/experimental-BMzbGmT5.js`). The command is hidden from `openclaw --help` without it.
- `openclaw claws {create,validate,dev,build,inspect,add,status,update,remove,export}` (`claws --help` output, claws.md "Command reference").
- `add <source> [--agent-id <id>] [--workspace <path>] [--dry-run] [--json] [--plan-integrity <sha256>] [--yes]`. `update <claw-or-agent> [--from <source>] [--dry-run] [--yes] [--plan-integrity]`.
- Non-interactive flow: `add --dry-run --json` returns `planIntegrity`, then `add --yes --plan-integrity <digest>`. `--yes` alone is refused. Per-agent `--agent-id`/`--workspace` supported (claws.md "Inspect and preview"). I ran the dry-run successfully in the container.

## Source types and integrity
- `add` help: "Path to a Claw package directory or grouped manifest". claws.md: "The current CLI reads a local package directory, CLAW.md, or grouped JSON manifest. Publishing, searching, and installing whole Claws through ClawHub are a separate registry track and are not part of this command surface yet."
- So: NO Git source, NO ClawHub `claw` family install, NO remote archive in this version. A `.tgz` is only an output of `claws build` (deterministic, reports SHA-256); `add` does not take one per its help (I did not test passing a tgz: UNVERIFIED).
- Directory installs carry integrityKind `development-snapshot` (dry-run output), not a published digest. Skill/plugin `packages` are pinned exact ClawHub versions and preflighted for integrity and trust warnings (claws.md "Skills and plugins").

## What an install writes
New agent entry in OpenClaw config plus new workspace: SOUL.md from the CLAW.md body, bootstrap files, `workspace.files`, optional BOOTSTRAP.md, workspace skills, MCP servers into `mcp.servers`, cron jobs via Gateway, provenance records, and shared plugins (process-wide, not per-agent) (claws.md "Adding a Claw..." and "Cron/MCP"). `profiles/openclaw.yml` is NOT copied into user config; it is validated and used while adding (tool allow/deny, `workspaceOnly`, memory, `extensions`) (claws.md). Per-agent: yes, creates one NEW agent; "does not replace or modify an existing agent", and existing files are not overwritten.

## Unknown files (`profiles/opengroow.yml`)
Tested in the container: a package with `profiles/opengroow.yml` (even containing an unknown key) dry-runs fine and is ignored by `add`. `claws build` excludes it ("Excluded project paths: 1"; tarball contains only package.json, CLAW.md, workspace/AGENTS.md), consistent with claws.md "only ... sources selected by the manifest are included". Consequence: a built Claw artifact would drop opengroow.yml, so OpenGroow would still need its own copy of the profile.

## Stability
claws.md: "Claws are experimental. Their schema, command output, and lifecycle may change." Output carries `"stability":"experimental"`; build prints "contracts may change while RFC 0016 is under review". Already deprecated one pointer (`metadata.openclaw.config`). Rated high breaking-change risk. Failures can be `update_partial` (not transactional).

## Fit against OpenGroow requirements
- Mismatch: `add` only creates NEW agents with a path-derived id; OpenGroow reconciles/replays registry state onto an existing Instance and refreshes workspace files (#642 "Instance as reconciled state"). `update` takes only a local source, and `--yes` plan consent is interactive-style.
- Mismatch: fetching, Git, digest verification and the hub are not provided; OpenGroow needs them in Convex (an action, no OpenClaw CLI available there; installs would have to go via the broker/control socket).
- Overlap: strict CLAW.md validation, exact skill/plugin pinning with preflight, openclaw.yml validation, ownership/drift tracking.

## Recommendation: do not delegate fetch/verify/registry; delegate at most later, partially
Keep `claw-package.ts`, `git-archive.ts`, `hub-index.ts`, `template_registry_store.ts` for fetching, digest verification, version pinning and the per-Project registry: OpenClaw offers none of those for Git/archive/hub in 2026.9.1 and is experimental. Optional partial reuse (spike, not now): after OpenGroow materializes a package into a temp folder on the Instance, run `openclaw claws add <dir> --dry-run --json` as an extra validator, or use it for first install only (new agent). Do not depend on it for update/reprovision. Revisit when the ClawHub `claw` family and `add` from registry/archive ship and the experimental flag is dropped. The adapter in #642 correctly isolates schema churn; keep `profiles/openclaw.yml` and CLAW.md fields compatible so a later switch stays cheap.
