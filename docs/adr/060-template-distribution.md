# ADR-060: Templates are distributed from a hub of release assets; ClawHub comes later

**Status:** Accepted (#722, spec #710). Builds on ADR-054, ADR-056, ADR-057 and ADR-058, which stay as written.

## Context

Templates left the compiled bundle (ADR-058) and live in repositories of their own. The product needs one way to find, verify and install them, usable without a registry account, and a path to the OpenClaw ClawHub when it accepts Claw packages of the `claw` family (not open yet, #725).

## Decision

- **Hub layout.** A hub is a repository with `index.json` (catalogue), `packages/<name>/` (Templates, with their own OpenClaw plugins) and `tools/<name>/` (machine-side tools). `hub-template/` in the product repository is the skeleton.
- **Release assets.** A release is a tag `<name>@<version>`. A workflow runs `pnpm pack`, attaches the `.tgz` to a release and opens a pull request updating the entry of `index.json` (`repository`, `tag`, `asset`, `digest`). The installer downloads the asset and checks its sha256 against the index before extracting anything. An installed version is immutable.
- **Two hubs, same layout.** `OpenGroow/groowhub` is public (installed by anyone, unauthenticated). `OpenGroow/private-groowhub` is private staging: its Templates are installed from a local clone with `template:add` because the installer downloads without authentication. A Template moves to the public hub when generic enough (could someone else run it with their own MCP?). The first public batch is `@opengroow/source` only.
- **Trust levels.** Each index entry carries `official`, `verified` or `community`. The reserved `@opengroow` scope is `official` only; the parser rejects any other level claiming it.
- **ClawHub later.** Templates are native OpenClaw Claw packages, so the same package can be published to ClawHub in the `claw` family once the server accepts it. Until then the hub is the only channel. Unverified: ClawHub behaviour with `profiles/opengroow.yml`, and the availability of the publisher handle `opengroow`.

## Alternatives considered

- **Templates inside the product repository** (status quo before ADR-058): couples Template releases to product releases and makes every private Template a product secret.
- **A hosted registry of our own**: an account system and a service to run, for a catalogue that a repository serves for free.
- **ClawHub now**: not open for the `claw` family; building on it would block the first release.

## Consequences

- Publishing a Template is a tag in the hub, never a product release.
- The product reads only `groowhub` and local folders; it never reads `private-groowhub`.
- Moving to ClawHub is additive: the package format does not change, only where the digest comes from.
