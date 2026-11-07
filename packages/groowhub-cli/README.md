# @opengroow/groowhub-cli

The tooling of the OpenGroow hub repository (groowhub). It checks and builds what the hub distributes with the code the product runs at installation, so the hub validates and releases its packages in CI without a checkout of the product.

```bash
# Templates
npx @opengroow/groowhub-cli@0.1.0 validate template packages/seo [--tag seo@1.0.0]
npx @opengroow/groowhub-cli@0.1.0 validate index index.json

# Publisher packages (ADR-072)
npx @opengroow/groowhub-cli@0.1.0 validate publisher packages/publisher/postiz
npx @opengroow/groowhub-cli@0.1.0 validate index publishers.json --kind publisher
npx @opengroow/groowhub-cli@0.1.0 pack publisher packages/publisher/postiz --out dist [--index publishers.json]
```

Exit code 0 when valid, 1 otherwise; every problem is printed. `pack publisher` bundles `src/index.ts` into `dist/plugin.mjs`, adds `manifest.json` and `data/`, and runs `npm pack`; with `--index` it also writes the package's entry in a `publishers.json` (local trials only: in a release a maintainer adds the entry in a reviewed PR).

From the OpenGroow checkout, `pnpm publisher:pack <folder> --out ../groowhub/dist --index ../groowhub/publishers.json` runs the same command from source (see `docs/PUBLISHER_PLUGINS.md`).

## Versions

The CLI is a bundle of `packages/agent-templates` (`validate-package.ts`, `hub-index.ts`, ...) and `packages/publisher-sdk` (manifest and capabilities readers) taken at publication time. A package that uses a field added after that version is rejected as an unknown key: publish a new version with each change to a manifest reader, and pin the version in the hub CI. `esbuild` is the only runtime dependency (used by `pack`).

It replaces `@opengroow/template-validator` (last version 0.2.2, deprecated): `package` became `validate template`.

## Publishing

The code is not copied anywhere: `dist/cli.js` is bundled from the repository at publication time, so the published CLI is exactly the readers of the commit it is built from. The **Publish groowhub CLI** workflow does it on a tag:

```bash
# bump "version" in this package.json, merge, then:
git tag groowhub-cli@0.1.1 && git push origin groowhub-cli@0.1.1
```

There is no npm token: the workflow uses npm trusted publishing (OIDC), configured on npmjs.com for this package (Settings, Trusted Publisher, GitHub Actions; repository and workflow file `publish-groowhub-cli.yml`). Update that setting if the repository or the workflow file is renamed; the `repository` field of this package.json must also match the repository once it is public. Tag only from `main`.
