# Writing an Analytics Adapter

An Analytics Adapter reads how one Publication performed at a measuring service (ADR-078, terms in `docs/domain/publishing.md`). It is separate from a Publisher: the service that publishes a post is not always the one that measures it. The core owns the schedule, the retries, the Performance Snapshots and the closed metric vocabulary; the adapter only answers "what are the numbers of this post right now". Reference implementation: `packages/analytics/postiz` in the hub (groowhub), published as `@opengroow/analytics-postiz`. Contract: `packages/publisher-sdk/src/analytics.ts` (`ANALYTICS_CONTRACT_VERSION = 1`, versioned on its own, independent of the Publisher contract).

Only official packages verified by the hub may contain code, as for a Publisher (ADR-070, ADR-072). There is no isolation: the code runs in the core's Node actions with its rights.

## Package layout

An Analytics Adapter is a hub package of its own kind, `analytics`. A hub package has one kind, so the Postiz adapter is not a second role of `publisher-postiz`: it ships as its own package, and a Publisher package does not have to change to be measured.

```
groowhub/packages/analytics/<id>/
  package.json            # name @opengroow/analytics-<id>
  manifest.json           # see below
  data/metrics.json       # the service's labels mapped to the closed vocabulary
  src/index.ts            # default export: the AnalyticsAdapter
  src/<service>.ts        # the read function
  src/<service>.test.ts   # stubbed-fetch tests
  fixtures/               # real answers of the service
```

Packed name `analytics-<id>`, release tag `analytics-<id>@<version>`, hub index `analytics.json`, bundle `dist/plugin.mjs`. Pack and try it locally with `pnpm exec groowhub pack analytics <folder> --out <dir> --index <hub>/analytics.json` (same circuit as in `docs/PUBLISHER_PLUGINS.md`, "Trying a package locally"); `apps/convex/test/analytics_hub_chain.test.ts` runs it. The core installs it through `hub_packages_node.install` with `kind: "analytics"`, keeps the manifest as the package's `meta` (`analytics_adapters.ts`) and evaluates the code only in Node actions (`analytics/load_node.ts`). The code must not import from `apps/*`; the SDK is imported as types.

## The manifest

Read at install without running the code (`parseAnalyticsManifest`):

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (lowercase letters, digits, dashes; the value a channel is linked to), display name |
| `contractVersion` | `2` (`ANALYTICS_CONTRACT_VERSION`, ADR-079) or `1` (still read as before: closed vocabulary, `kind` in `data/metrics.json`); another version is refused |
| `metrics` (contract 2, required) | The adapter's own metrics, in the order of the columns: `{ key, label, type: "counter" or "level", format: "number", "percent" or "duration", better?: "higher" or "lower", derive?: { sum: [keys], per: key } }`. A derived metric is a level and is never stored |
| `primary` (contract 2, required) | The metric that ranks the posts: one of `metrics`, not derived |
| `collect` (contract 2) | Default reading delays, durations like `3d` or `12h` |
| `secret` (contract 2) | `{ label, kind: "text" or "json", fields? }`: what the connection's key is. A `json` secret is a multi-line field with a "Choose a file" button; the core refuses a value that is not JSON with the `fields` named |
| `needsUrl` (contract 2) | `false` when the connection has no URL to give (default `true`) |

With contract 2 the core stores, in a Snapshot, the declared non-derived keys that are finite numbers >= 0 and drops the rest (`pickDeclaredMetrics`); a Counter is returned cumulative since publication. `data/metrics.json` has no `kind`, and its labels map to declared stored metrics.
| `needs` | The key it needs from a Publication: `externalId` or `url` |
| `publisher` | The Publisher (its adapter id) this adapter belongs to. Required when `needs` is `externalId` |
| `earliestDelayMs` | Earliest delay after publication at which the service can report, ms, 0 or more |
| `options` | What a Project may set: `{ key, label, type: "number" or "text", default, min?, max? }` |

## The function contract (`AnalyticsAdapter`)

```ts
interface AnalyticsAdapter {
  id; name; contractVersion; needs; earliestDelayMs;  // same values as the manifest
  read(conn: AnalyticsConnection, request: ReadRequest): Promise<AnalyticsResult>;
}
```

- `conn`: `{ url, apiKey, options? }`, the Project's own connection to the adapter (set once on its Analytics page, `analytics_connections.ts`). An adapter that belongs to a Publisher falls back to the Publisher's connection. `options` holds the values the Project gave; a missing one means the declared default.
- `request`: `{ externalId?, url?, kind, publishedAt }`. Only the key named by `needs` is set. `kind` is the metric kind (`social` or `article`, `metricKindOf`).
- Return `{ ok: true, reading }` or `{ ok: false, error }`. Do not throw for an expected case; the core also catches a throw and records it as a failure.

## The key

The adapter declares which key it needs from the Publication to find the post on its side (ADR-078): `externalId` (the id the publishing service gave, Postiz) or `url` (the public URL of the page, Google Analytics). An adapter that needs `externalId` only works with the Publisher named in `publisher`: the id only means something to that service. The key is free for now; the vocabulary closes when a third kind appears. The core tries no reading before the Publication has the key (the reading is postponed and retried in an hour).

Channel linking: each Publish target is linked to at most one adapter. By default a channel uses the installed adapter whose `publisher` is its Publisher (`linkedAdapter`); a link can be made by hand to another adapter that can measure it (`canMeasure`), or removed. A channel with no link is "analytics unavailable", which is not "no data yet".

## Delays

Readings are counted from the moment the Publication became `published`: A Mission type opts in with `analytics: { collect? }` (`docs/TEMPLATE_DEVELOPMENT.md`, "Being measured"). The delays are the Template's `collect` if it gives one, else the adapter's `collect` (contract 2), else 1, 3 and 7 days (`DEFAULT_COLLECT_DELAYS_MS`). The adapter says what it can: no delay is shorter than `earliestDelayMs`, and delays that then fall on the same moment are one reading. Declare `earliestDelayMs` honestly (Postiz: 1 hour; a service that does not report before about two days: 2 days).

## Metric mapping

The vocabulary is closed per kind and owned by OpenGroow (`METRIC_VOCABULARY`): `social` has `views`, `reach`, `likes`, `comments`, `shares`, `saves`; `article` has `pageviews`, `visitors`, `engagementTime`. Adding a metric is a change of OpenGroow, not of an adapter or Template.

`data/metrics.json` maps the labels the service returns to the vocabulary of one kind:

```json
{ "schemaVersion": 1, "adapter": "postiz", "kind": "social", "labels": { "Views": "views", "Reach": "reach" } }
```

`parseAnalyticsMetrics` refuses a label that maps to a metric outside the kind. In `read`, return `metrics` as a record of numbers; the core runs `pickMetrics`, which keeps only vocabulary metrics whose value is a finite number >= 0 and ignores the rest. Convert strings yourself (Postiz returns `total` as a string). A missing label is normal (TikTok has no `Reach` or `Saves`), not a failure. If nothing mappable remains the core treats the reading as `no_data`.

## Reading states

`read` returns one of:

| Result | Meaning | What the core does |
| --- | --- | --- |
| `{ ok: true, reading: { status: "taken", metrics } }` | Numbers found | Stores a Performance Snapshot (`source: "adapter"`); next delay, or `complete` after the last |
| `{ ok: true, reading: { status: "no_data" } }` | The service answered but has nothing yet | State `no_data`, retried in an hour; not an error |
| `{ ok: true, reading: { status: "unavailable", reason } }` | The service no longer knows the post | State `post_unknown` with the reason; stops, keeps earlier Snapshots |
| `{ ok: false, error }` | Network, auth, unreadable answer | State `failed` with the error, retried in an hour |

Failure is local to the reading: the Publication stays valid. Tell `no_data` from `unavailable` when the service lets you (Postiz answers `[]` for both, so its adapter looks the post up in the posts listing around the publication date). A retried Publication that creates a new post starts a new series of Snapshots; the old ones are kept.

## Rules

- Official only: no unverified third-party package may be installable.
- Only Publications made by OpenGroow are measured in V1; importing existing posts is out.
- Snapshots belong to one Publication, never to a Mission; never add numbers across platforms.
- No per-service code in the core or the dashboard: everything goes through the manifest, `metrics.json` and the closed vocabulary (ADR-020).
- Test with a stubbed `fetch` and real recorded answers in `fixtures/` (see `packages/analytics/postiz/src/postiz-analytics.test.ts` in the hub).
