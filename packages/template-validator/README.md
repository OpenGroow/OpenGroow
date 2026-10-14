# @opengroow/template-validator

Validates OpenGroow Template packages and hub indexes with the code the product runs at installation (#672), so a hub repository can check every package in CI without a checkout of the product.

```bash
npx @opengroow/template-validator@0.1.0 package packages/seo [--tag seo@1.0.0]
npx @opengroow/template-validator@0.1.0 index index.json
```

Exit code 0 when valid, 1 otherwise; every problem is printed.

## Versions

The validator is a bundle of `packages/agent-templates` (`validate-package.ts`, `hub-index.ts` and what they import) taken at publication time. A package that uses a manifest field added after that version is rejected as an unknown key: publish a new version with each change to the manifest reader, and pin the version in the hub CI.

## Publishing

The code is not copied anywhere: `dist/cli.js` is bundled from `packages/agent-templates` at publication time, so the published validator is exactly the reader of the commit it is built from. The **Publish Template Validator** workflow does it on a tag:

```bash
# bump "version" in this package.json, merge, then:
git tag template-validator@0.1.1 && git push origin template-validator@0.1.1
```

There is no npm token: the workflow uses npm trusted publishing (OIDC), configured on npmjs.com for this package (Settings, Trusted Publisher, GitHub Actions; repository and workflow file `publish-template-validator.yml`). Update that setting if the repository or the workflow file is renamed; the `repository` field of this package.json must also match the repository once it is public. Publish a new version with each change to the manifest reader, and bump the pinned version in the hub CI.
