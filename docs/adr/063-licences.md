# ADR-063: Product under AGPL-3.0-only, hubs under MIT, contributions by DCO

**Status:** Accepted (#722, #721). DCO confirmed by the maintainer on 2026-10-11 (sole contributor at the time). Details, dependency audit and open items: `docs/LICENSING.md`. This is an engineering audit, not legal advice.

## Context

The repository is about to become public. The licence must be chosen before anything is published, and contributions need a policy that does not block a later change of direction by accident.

## Decision

- **Product: `AGPL-3.0-only`** (not `-or-later`, so a future licence version needs our decision). Enforced by `scripts/license-policy.test.ts`. AGPL obliges a modified network service to publish its changes; it does not forbid offering the unmodified product as a service.
- **Hubs: MIT** (`hub-template/LICENSE`). They are data and workflows; the AGPL product installs MIT content without constraint. Each Template declares its own `license`.
- **Contributions: DCO** (`Signed-off-by`, `git commit -s`). It needs no paperwork or bot, but gives the maintainers no right to relicense contributions: a later dual-licence or commercial model would need every contributor's consent. While the maintainer is the sole contributor relicensing stays free; if it is ever wanted, switch to a CLA **before** the first external contribution.
- **Third-party material** is never committed without its licence text. Developer tooling directories are not carried to the public repository (docs/CUT-EXCLUSIONS.md).

## Alternatives considered

- **BSL/FSL (source-available)**: the only way to forbid competing hosting, but not open source.
- **Apache-2.0 hubs**: adds an explicit patent grant; MIT is kept unless that matters.
- **CLA**: keeps relicensing power at the cost of a bot and contributor friction.

## Consequences

- Open items before publication are the checklist at the end of `docs/LICENSING.md` (lawyer review, including the Convex FSL point, Linux image scan).
