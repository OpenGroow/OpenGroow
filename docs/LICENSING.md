# Licensing

Issue #721 (parent #710). **This is an engineering audit, not legal advice.**
Have it reviewed by a lawyer before the repository becomes public. Items we
could not verify are marked **UNVERIFIED**.

## Decisions

| Artifact | Licence | Where |
| --- | --- | --- |
| OpenGroow product (this repository) | `AGPL-3.0-only` | `LICENSE`, `license` in every product `package.json` |
| Hubs (`groowhub`, `private-groowhub`) | `MIT` | `hub-template/LICENSE` (copied to the hub repositories) |
| Contributions | None accepted for now (sole contributor); DCO planned | no `CONTRIBUTING.md` yet |

We use `AGPL-3.0-only` (not `-or-later`) so that a future licence version
cannot be applied without our decision.

What AGPL-3.0 does and does not do: anyone who offers a modified version as a
network service must publish their modifications under AGPL-3.0. It does **not**
forbid a competitor from offering the unmodified product as a service; only
"source-available" licences (BSL, FSL, ...) do that, and they are not open
source. Removing the login in self-host changes nothing about this.

## Policy

- **Product**: AGPL-3.0-only. `LICENSE` at the root, `"license": "AGPL-3.0-only"`
  in every shipped `package.json` (apps, packages, plugins). Enforced by
  `scripts/license-policy.test.ts`.
- **Excluded from the field requirement**: test data
  (`fixtures/`, `**/__fixtures__/`), which stand for third-party Template
  packages and must stay byte-stable, and `hub-template/` (a separate
  repository, MIT).
- **File headers**: no per-file header is required. The root `LICENSE` and the
  `package.json` field are authoritative. Do not add a copyright header to
  existing files. A file copied from another project keeps its original header
  and must be compatible (see below). If a header is ever wanted, use the
  single SPDX line `// SPDX-License-Identifier: AGPL-3.0-only`.
- **Third-party material**: never commit copied third-party code, assets or
  skills without their licence text and a note in the table below.
  `.agents/skills/` (and the `.claude/skills` link to it) is developer tooling,
  not carried over to the public repository. Skills under it are covered by
  their own licence (the two tracked files, `openclaw-runtime-feature`, appear
  to be project-authored; **UNVERIFIED** that nothing in them was copied from a
  third party).
- **Hub Templates**: a Template package declares its own `license` in its
  `package.json`; the hub's MIT licence covers the hub tooling and
  officially maintained Templates, not third-party submissions.

## Dependency audit

Method: `pnpm install --frozen-lockfile && pnpm licenses list --json` at the
tip of `integration/710-phase3-cut` (2026-10-11), on macOS arm64. Counts are per
distinct package version across all workspaces, dev and runtime together.

| Licence | Packages | AGPL-3.0 compatible |
| --- | --- | --- |
| MIT, MIT-0, ISC, 0BSD, BSD-2/3-Clause, Apache-2.0, Unlicense, BlueOak-1.0.0, Python-2.0 (`argparse`), (MIT AND Zlib) | ~675 | Yes (Apache-2.0 is one-way compatible with GPLv3/AGPLv3) |
| MPL-2.0 | 6: `lightningcss`(+darwin), `web-push`, `@ubjs/*` | Yes. MPL-2.0 section 3.3 allows combination with AGPL; MPL files stay MPL. We do not modify them |
| (MIT OR GPL-3.0-or-later) | `jszip` | Yes. Dual licence, we use it under MIT |
| MIT OR Apache | `sqlite-vec` | Yes |
| CC-BY-4.0 | `caniuse-lite` (data) | Yes for data. Requires attribution, satisfied by keeping the package notice |
| LGPL-3.0-or-later | `@img/sharp-libvips-darwin-arm64` (prebuilt libvips used by `sharp`) | Yes, LGPLv3 may be combined with AGPLv3. It is dynamically loaded, not modified. Keep the notice if we ever ship it in an image |
| MIT AND MPL-2.0 | `@trycua/cua-driver-darwin-arm64` | Yes |

No GPL-only, AGPL-only, SSPL, BSL or "non-commercial" licence was found among
resolved packages. **Limits**:

- The audit ran on darwin-arm64, so Linux-only optional dependencies
  (`@img/sharp-libvips-linux-*`, `lightningcss-linux-*`, ...) were not listed.
  Their licences match their darwin siblings; re-run
  `pnpm licenses list --json` inside the built Docker images to confirm.
  **UNVERIFIED** for Linux.
- `pnpm licenses` trusts the `license` field of each package. Packages with
  missing or wrong metadata are not detected. No licence-scanner (for example
  `license-checker`, ScanCode) was run. **UNVERIFIED**.
- Transitive dependencies installed *inside* container images by `npm install -g`
  (see OpenClaw below) are not in the pnpm lockfile and were not enumerated.

Re-run the audit before each release; consider adding a CI check that fails on
a licence outside the allow-list above.

## Docker images and external components

OpenGroow's compose files **pull** third-party images; the project does not
redistribute them. The obligations of their licences fall on whoever publishes
them (and on the operator running them), not on OpenGroow's AGPL scope, as long
as OpenGroow talks to them over the network and does not link or embed them
(mere aggregation).

| Component | Source in repo | Licence | Status |
| --- | --- | --- | --- |
| Self-hosted Convex backend `ghcr.io/get-convex/convex-backend:latest` and dashboard `convex-dashboard:latest` | `apps/convex/docker/docker-compose.yml` | **FSL-1.1-Apache-2.0** (Functional Source License, converting to Apache-2.0 two years after each release). Checked on `get-convex/convex-backend`'s `LICENSE.md`. GitHub reports `NOASSERTION`: it is **not** an OSI open-source licence | **Documented incompatibility, not a blocker.** FSL is not AGPL-compatible for a combined work, and its non-compete clause forbids using the Software to offer a competing product to Convex. We do not link, modify or redistribute it: it runs as a separate container the operator pulls themselves. Consequences: (1) the README must say that the self-host stack depends on a source-available component under its own terms; (2) never publish a derived Convex image; (3) the `convex` npm client library is a different artifact (npm licence field, see the pnpm audit above) and was not found problematic. **UNVERIFIED**: whether the dashboard image carries the same licence and whether the licence of the hosted image tag matches the repository `LICENSE.md`; whether your intended use falls within FSL "Permitted Purpose" (ask a lawyer). Pin image tags instead of `latest`. **Maintainer position (2026-10-11)**: Convex is used only as the product's own database, never offered as a Convex-like service, and only through the official, unmodified images; that is the use FSL permits, but it stays to be confirmed by the lawyer review |
| OpenClaw (`openclaw`, plus `@openclaw/xiaomi-provider`, `@openclaw/groq-provider`) | `apps/openclaw-docker-config/docker/Dockerfile`, pinned in `OPENCLAW_VERSION` (2026.9.1) | `openclaw` and its GitHub repository: MIT. `npm view` for the two `@openclaw/*-provider` packages returned no licence | `openclaw`: compatible. Providers: **UNVERIFIED**, check their `package.json` / LICENSE file in the published tarball before the cut |
| ClawHub CLI (`clawhub`, npm global in the same image) | idem | MIT (`npm view`) | Compatible |
| Image bases `node:22-bookworm-slim`, `alpine` | Dockerfiles, `docker-compose.yml` | Mixed (Debian packages: GPL, LGPL, etc.; Alpine: various; Node: MIT) | Standard base-image practice; we ship no modified copy of these packages. Our published images (if any) must keep Debian copyright files, which the base image already does |
| Apt packages in the OpenClaw image: `git`, `curl`, `chromium`, `jq`, `tini`, `gnupg`, `ca-certificates`, GitHub CLI `gh` | Dockerfile | GPL-2.0 (git), curl (MIT-like), BSD-3 + others (Chromium), MIT (jq, gh), MIT (tini), GPL-3.0 (gnupg) | Aggregation in a separate image: fine. If OpenGroow publishes this image, GPL source-offer obligations apply to git/gnupg (satisfied via Debian source packages, but publish the Dockerfile and point to them). **UNVERIFIED** against a built image SBOM |

### Python engine of the Android CLI (moved to private-groowhub, `tools/android/engine`)

The Android CLI is not part of this repository any more (#720); this finding is
kept for the licensing review of that repository. Imports found: standard
library, `uiautomator2` (PyPI metadata: MIT), `PIL` (Pillow, PyPI
`license_expression`: MIT-CMU, a permissive HPND-style licence) and `requests`.
All are AGPL-compatible. The tool now has a `requirements.txt`. **UNVERIFIED**:
the transitive Python dependencies of `uiautomator2` (for example `lxml`,
`adbutils`, `retry2`, `whichcraft`) were not enumerated; run `pip-licenses` in
the engine venv.

### Other items

- Android UI anchors, app names ("Instagram", "TikTok") and trademarks are
  used only as identifiers for automation; trademark use is not covered by any
  copyright licence. Out of scope here.
- Fonts and images in `apps/dashboard`: no font files are tracked; Next.js
  `next/font` fetches Google Fonts (OFL / Apache). **UNVERIFIED** for images and
  icons (not inspected).
- The dashboard UI library licences are covered by the pnpm audit above.

## Contributions: CLA or DCO

**Recommendation: DCO** (a `Signed-off-by:` line on each commit,
`git commit -s`).

- Why: no legal paperwork, no tooling account, no friction for the first
  contributors of a young project; it certifies the contributor has the right to
  submit the code under the project licence (AGPL-3.0-only).
- What it gives up: a DCO does **not** grant the maintainers the right to
  relicense contributions. With DCO contributions stay AGPL-3.0-only forever,
  so a later move to a dual-licence or "open core" model would need every
  contributor's consent.
- When to choose a CLA instead: only if keeping the ability to relicense (for
  example selling a commercial licence) is a real requirement. A CLA requires a
  bot (for example CLA Assistant), a signing step for every contributor, and has
  a measurable chilling effect on contributions.

**Decision (maintainer, 2026-10-11): DCO.** The maintainer is the only contributor
today, so the choice costs nothing now. Relicensing stays free as long as every
line is the maintainer's own; it stops being free with the first external
contribution. If a dual-licence or commercial model is ever wanted, decide it
**before** accepting the first external contribution, and switch to a CLA then
(write a `CONTRIBUTING.md` with the CLA and add a CLA bot).

## Hub licence and README statement (ready to copy)

Audit result: nothing forces a different licence. The hub is data and workflows
(index, tooling, Template packages), with no AGPL component linked in. MIT is
the licence already in `hub-template/LICENSE`, so it is carried over unchanged.
Choose Apache-2.0 instead only if you want an explicit patent grant. The product
(AGPL) can read and install MIT content without constraint.

Copy `hub-template/LICENSE` to the root of `groowhub` and `private-groowhub`
and make sure the README ends with:

```markdown
## License

The hub tooling, index and the Templates maintained in this repository are
released under the MIT License, see `LICENSE`. Each Template package declares
its own `license` in its `package.json`; third-party Templates keep their
authors' licences.

The OpenGroow product that installs these Templates is licensed separately
under AGPL-3.0-only. Contributions are accepted under the Developer Certificate
of Origin (sign your commits with `git commit -s`).
```

(`hub-template/README.md` carries this statement.)

## Checklist before the repository becomes public

- [ ] Lawyer review of this document, especially the Convex FSL point
- [x] DCO vs CLA decided: DCO (sole contributor; revisit before the first external contribution if relicensing matters)
- [ ] Linux-image licence scan (pnpm in the built images, `pip-licenses`, SBOM)
- [ ] Licence of `@openclaw/*-provider` packages checked
- [ ] Convex image tags pinned and FSL statement added to the public README
- [ ] Hub repositories created with `LICENSE` and the statement above
