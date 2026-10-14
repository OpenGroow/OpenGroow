# groowhub

The public hub of official OpenGroow Templates (`@opengroow/*`). It is a plain
GitHub repository:

```
index.json                 one entry per package: what installs, and its digest
packages/<name>/           one folder per Template (package.json, CLAW.md, workspace/, profiles/, plugins/)
tools/update-index.mjs     used by the release workflow
.github/                   validation, release and secret-scan workflows, CODEOWNERS
```

OpenGroow reads `index.json` from this repository (`OPENGROOW_HUB_REPOSITORY`,
default `OpenGroow/groowhub`) and installs an entry by downloading the release
asset it names and checking its sha256 against the index before extracting
anything.

> This folder is the template of that repository, kept next to the product
> code (`hub-template/` in the OpenGroow repository) so that the workflows stay
> in step with the installer. Copy its contents (not a `.git`) into the hub
> repository.

## Releasing a package

1. Bump `version` in `packages/<name>/package.json` and merge the change.
2. Push a tag `<name>@<version>` (for example `source@1.2.0`).
3. The **Release** workflow runs `pnpm pack`, attaches the `.tgz` to a GitHub Release, and opens a PR that
   updates the package's entry in `index.json` (`repository`, `tag`, `asset`,
   `digest`).
4. A code owner reviews and merges that PR. Only then does the new version
   become installable.

A package's **first** entry in `index.json` (`id`, `name`, `description`,
`category`, `verification`) is written by a maintainer in a reviewed PR; the
release workflow only moves an existing entry, it never grants a trust level.

Example entry:

```json
{
  "id": "@opengroow/source",
  "name": "Source",
  "description": "…",
  "repository": "OpenGroow/groowhub",
  "tag": "source@1.2.0",
  "asset": "opengroow-source-1.2.0.tgz",
  "digest": "sha256:<64 hex>",
  "category": "system",
  "verification": "official"
}
```

## Validation

Packages are validated by hand, from a OpenGroow checkout, before tagging:
`pnpm template:validate <folder> --tag <name>@<version>` and
`pnpm template:validate-index <index.json>`. CI only runs a
[gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole history on
every pull request and push to `main`.

## Repository settings (trust root)

The index decides what installs on users' deployments, so:

- mandatory 2FA for the organization;
- `main` protected: pull requests only, required status checks (`Validate`),
  required review from code owners (see `.github/CODEOWNERS`, set the real
  team), no force-push;
- Settings, Actions, General: workflow permissions "Read repository contents"
  by default, and "Allow GitHub Actions to create and approve pull requests"
  enabled (the release workflow opens the index PR; PRs opened with
  `GITHUB_TOKEN` do not trigger other workflows, so a maintainer may need to
  push an empty commit or re-run **Validate** on it);
- tag protection (or a ruleset) on `*@*` so only maintainers can release;
- the workflows hold no secret from the OpenGroow repository: they use
  `GITHUB_TOKEN` only.

## License

The hub tooling, index and the Templates maintained in this repository are
released under the MIT License, see `LICENSE`. Each Template package declares
its own `license` in its `package.json`; third-party Templates keep their
authors' licences.

The OpenGroow product that installs these Templates is licensed separately
under AGPL-3.0-only. Contributions are accepted under the Developer Certificate
of Origin (sign your commits with `git commit -s`).
