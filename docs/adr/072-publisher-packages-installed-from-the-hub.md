# ADR-072: Hub packages have a `kind`; Publishers are the first code kind, run in Node actions

**Status:** Proposed

## Context

ADR-070 made a Publisher plugin an isolated code module and left "loading from the hub" open: the plugin is a workspace package (`packages/publisher-postiz`) imported statically by `apps/convex/publisher/registry.ts`, so a new service means a code change, a rebuild and a release of the product. The goal is to keep optional, non-OpenClaw capabilities in the hub, installed per deployment, starting with Publishers.

ADR-070 assumed that "Convex cannot load external code dynamically". A spike (2026-11-06, isolated local deployment, Node 24) showed it can, **in Node actions** (`"use node"`): a bundled plugin (one ES module, 20 KB with the SDK and the two JSON data files inlined) loaded through `import("data:text/javascript;base64,…")` or `new Function(...)` runs, calls `fetch` and returns the expected `PublisherResult`. `vm.SourceTextModule` is unavailable. The same bundle was then run on the official self-hosted image (`ghcr.io/convex/convex-backend`, Node 24.22) against a stateful Postiz stub: `testConnection` (ok, 401, unreachable classified `uncertain`), `listChannels`, `publish` (media upload, `beforePost` called with the uploaded media, post created), `findPost` (found, and `null` for another caption), `getStatus`, `postUrl`. The module loaded in 5 ms. Not yet verified: Convex cloud, the bundle round trip through file storage, and a cold start under load.

Code cannot load in queries and mutations (V8 runtime). Today `pluginFor` is also called there: `publishers.save`, `publications.listForMission` (the plugin's `postUrl`), `publication_targets` (capabilities), and the dashboard (`channelOptionsOf`, `capabilityOf`).

There is one code kind today. The mechanism must not be designed from a single example: only what is certainly common is shared, the rest stays specific to the Publisher.

## Decision

### 1. Two layers, kept apart

**Hub layer (no knowledge of Publishers).** In the hub repository, a package is a folder under `packages/` and an entry in `index.json` with a `kind`. In the product (`apps/convex`), a generic installer lists the catalogue by `kind`, downloads the release asset, verifies its sha256 against the index and stores it. It is the path Templates already use (`project_templates_node.ts`); it learns about `kind` and nothing else.

**Publisher layer (no knowledge of the hub).** The Publisher contract (`@opengroow/publisher-sdk`), the loader that turns a stored bundle into a plugin and calls its functions in a Node action, and the readers of its data. It knows what a Publisher does, not how the package arrived.

A second kind later reuses the hub layer and brings its own contract and loader. Nothing generic is built beyond the hub layer.

### 2. Code runs only in Node actions; everything else is data

| Part of a Publisher package | Used by | Stored as |
| --- | --- | --- |
| Functions: `testConnection`, `listChannels`, `publish`, `findPost`, `getStatus` | Node actions only | The bundle, loaded on demand |
| `capabilities.json`, `channel-options.json` | Queries, mutations, dashboard | Data, read at install |
| `id`, `name`, logo | Dialog, messages | Data |
| `postUrl` | The `listForMission` query | **Data**: a template `"{url}/p/{id}"` replacing the function |

The server refusal of unsupported channel/kind pairs and the dashboard read the same stored data (ADR-070 §3 holds).

### 3. Trust model: unchanged, and no isolation

Only `verification: "official"` entries can be installed (ADR-056/057/060). The bundle runs **in the core's Node process with the core's rights**: it can read `process.env` and call any host. This is acceptable only because the code is official and its digest verified. **This ADR provides no isolation.** An unverified third-party package must not be installable; allowing them needs a sandboxed runtime (a separate service with no secrets and an egress allow-list), which is a separate decision and would replace the loader of §2, not the hub layer.

### 4. Contract version

The SDK gains a `contractVersion`. The package manifest declares the one it was built for; the core refuses an incompatible bundle with a clear message.

### 5. Migration

Postiz moves to the hub as the first Publisher package. `registry.ts`, the workspace dependency, the Dockerfile COPY lines and the CI path filters for `publisher-postiz` go away. Existing Postiz Publishers get the package installed by a migration (same release, digest checked).

## What it looks like

Hub repository:

```
groowhub/
  index.json
  packages/
    source/                  # kind: template (as today, flat)
    publisher/               # one folder per code kind
      postiz/
        package.json         # name, version, "opengroow": { "kind": "publisher", "contractVersion": 1 }
        manifest.json        # id, name, logo, postUrl: "{url}/p/{id}"
        data/capabilities.json
        data/channel-options.json
        src/index.ts         # exports the plugin; tests next to it
```

The tag is the package's path plus the version: `source@1.0.0` releases `packages/source`, `publisher/postiz@1.0.0` releases `packages/publisher/postiz` (git tags allow `/`). The release workflow only widens its tag pattern to accept one `/` and flattens it in the asset file name (`opengroow-publisher-postiz-1.0.0.js`). The `kind` of an index entry is the first folder when there is one (`publisher`), `template` otherwise.

`index.json` entry (written by a maintainer in a reviewed PR; the release workflow only moves `tag`, `asset`, `digest`):

```json
{
  "id": "@opengroow/publisher-postiz",
  "kind": "publisher",
  "name": "Postiz",
  "tag": "publisher/postiz@1.0.0",
  "asset": "opengroow-publisher-postiz-1.0.0.js",
  "digest": "sha256:…",
  "verification": "official"
}
```

Product, hub layer (generic):

```ts
// hub_packages.ts — knows `kind`, nothing about Publishers
hubPackages: defineTable({ id: v.string(), kind: v.string(), version: v.string(), digest: v.string(),
  bundle: v.id("_storage"), manifest: v.any() }).index("by_id", ["id"])
export const installFromHub = action({ args: { id: v.string() }, … }) // list → download → verify digest → store
```

Product, Publisher layer:

```ts
// publisher/load_node.ts ("use node") — knows the contract, not the hub
export async function loadPlugin(ctx, adapter): Promise<PublisherPlugin> {
  const pkg = await ctx.runQuery(internal.hubPackages.get, { id: adapter });
  const source = await (await ctx.storage.get(pkg.bundle))!.text();
  const mod = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  return parsePlugin(mod.default, pkg.manifest); // checks contractVersion and shape
}
// publisher_node.ts: const plugin = await loadPlugin(ctx, prepared.connection.adapter);
```

Dashboard: Add a publisher lists `hubPackages` of `kind: "publisher"` available in the catalogue (installable) and installed; choosing one installs it, then shows the connection form.

## Options rejected

- **Hub package fetched at build time** (a tarball dependency pinned in `apps/*`): works with static imports but needs a rebuild per plugin, which is the problem being solved.
- **A generic extension framework now**: one code kind is not enough to know what is common beyond the hub layer.
- **Publisher as an OpenClaw Plugin of a Template**: the core would call the gateway to publish, so Publication reliability (`uncertain`, `findPost`) would depend on an Instance being up, against ADR-069.
- **Sandboxed runtime outside Convex now**: the right answer for third-party code, but a service to build and operate; deferred until third parties are a goal.

## Consequences

- Adding an official service is a hub PR and a release; no change and no deploy of the product.
- The dashboard reads capabilities and channel options through Convex queries instead of static imports, so they exist only for installed packages.
- Each Publisher call pays a bundle load on a cold isolate; a per-version cache bounds it, to be measured.
- Open risks, to settle before building: Convex cloud and self-hosted Docker behaviour, the size limit of file storage reads, the cost of a data-URL import on cold start.

## PR breakdown

1. **Verify**: run the spike on the self-hosted Docker stack with the real bundle and a faithful Postiz stub, including `publish` and `findPost`. Gate for the rest.
2. **SDK**: `contractVersion`, the manifest type and parser, `postUrl` as a template; Postiz switched to it (still static).
3. **Hub layer**: `hubPackages` table and `installFromHub`, reusing the Template download and digest code.
4. **Publisher layer**: `loadPlugin`, queries serving capabilities and options; `pluginFor` and the static registry removed from queries, mutations and the dashboard.
5. **Hub repository**: `kind` in `index.json`, the release workflow building the bundle, `publisher-postiz` moved to `groowhub/packages/publisher/postiz`, the release workflow and `update-index.mjs` accepting a path in the tag, validation of Publisher packages (validator bump).
6. **UI and migration**: the generic Add a publisher dialog and the migration of existing Postiz Publishers.
7. **Docs**: `docs/PUBLISHER_PLUGINS.md`, glossary, ADR-070 index annotation.
