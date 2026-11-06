# ADR-070: Publisher plugins are isolated code modules; the core keeps the Publication lifecycle

**Status:** Accepted

## Context

ADR-069 made the Publisher generic in concept but left the Postiz adapter inside Convex, with its HTTP calls, per-platform settings, capabilities and (in the dashboard) channel options. A second service would mean service knowledge merged into the core. The Template model forbids that for Templates ("Convex holds no service-specific knowledge", docs/domain/templates.md, ADR-020, ADR-021).

A first version of this ADR proposed a **declarative manifest** with its own step language (HTTP steps, filters, typed substitution, `$map`/`$when` nodes) interpreted by the core. That design is **superseded and dropped entirely**: it was a DSL to design, validate, document and keep evolving, for a problem a few functions solve. There is no manifest DSL, no step language, no interpreter.

## Decision

### 1. A Publisher plugin is a code module with a function contract

A Publisher plugin is an isolated TypeScript module that exposes a small set of functions the core calls, and nothing else. Terminology: it is not an OpenClaw Plugin (code loaded in the gateway).

```ts
interface PublisherPlugin {
  id: string; name: string;
  capabilities: CapabilitiesData;      // data file 1
  channelOptions: ChannelOptionsData;  // data file 2
  testConnection(conn): Promise<PublisherResult>;
  listChannels(conn): Promise<PublisherResult<{ channels }>>;
  publish(conn, request): Promise<PublisherResult<{ outcome }>>;
  findPost(conn, query): Promise<PublisherResult<{ post | null }>>;
  getStatus(conn, externalId, around?): Promise<PublisherResult<{ post }>>;
}
```

The plugin receives everything through its arguments (connection, channel and service, Publishable, stored channel settings, `publishAt`, media uploaded by an earlier attempt, an optional `beforePost` hook) and never imports from the application. It owns **all** knowledge of the service: URLs, auth, payloads, per-platform settings and rules, response parsing, error classification (`uncertain` vs rejected), matching a post in the service's listing. The types come from a small shared package, `@opengroow/publisher-sdk`.

### 2. The core keeps the lifecycle

The core (`apps/convex/publisher/` and the publication modules) owns what must be identical for every service: the Publication state machine and statuses (`pending`, `submitting`, `uncertain`, `scheduled`, `published`, `failed`), the claim before the post is created (`beforePost`), reconcile-before-resend through `findPost`, the done rule of a Mission, the polling cadence, `publishAt` rules, and the server-side refusal of unsupported channel/kind pairs. The plugin returns outcomes; the core decides statuses. A plugin registry maps a Publisher's `adapter` id to its plugin; no Postiz or platform name remains in `apps/convex`.

### 3. Two data files

A plugin ships `capabilities.json` (which Publishable kinds each platform carries: `supported | uncertain | unsupported`, with reasons; ADR-069 amendment) and `channel-options.json` (per-platform options the dashboard shows on a channel: `select | boolean | text`). Both are read by pure SDK readers and importable by Convex and the dashboard, so the UI and the server refusal never disagree.

### 4. Trust model

Code in a package is an exception to the principle of docs/domain/templates.md that a package contains no arbitrary code. It is acceptable only for **official Publisher packages verified by the hub** (groowhub: reviewed PRs, protected tags, sha256 digest, verification levels; ADR-056/057/060), which are the trust root. A third-party, unverified Publisher plugin must not run in the core process: it would need an isolation layer (isolate or sandbox with a capability API and resource limits) that this ADR does not build.

### 5. Migration path

1. **Now:** the plugin is a workspace package of this monorepo (`packages/publisher-postiz`), registered statically in the core. Its code is part of the product build.
2. **Later, separate step:** the same package is distributed through the hub as a Publisher package (versioned, digest, verification level) and installed per instance. Convex cannot load external code dynamically today, so this needs its own design (bundling at deploy, or a runtime outside Convex). It is deliberately **not built** here; the contract and the two data files are chosen so that moving the package is a file move.

### Options rejected

- **Declarative manifest and step language**: too complex (see Context).
- **An MCP server per service**: re-creates the per-MCP configuration ADR-069 removed, and the reconcile guarantees would depend on every author.
- **Adapters inside Convex, added by PR**: keeps service knowledge in the core.

## Consequences

- Adding a service is a new plugin package plus one registry line, with no change to the lifecycle.
- The plugin API is plain functions, testable with a stubbed `fetch` (docs/PUBLISHER_PLUGINS.md).
- The dashboard channel options and capabilities come from the plugin data, not from hard-coded dashboard files.
- Loading from the hub and isolating third-party code remain open.
