# ADR-079: Analytics Adapters declare their own metrics

**Status:** Proposed (amends ADR-078)

## Context

ADR-078 closed the metric vocabulary per kind and owned it in OpenGroow (social `views`, `reach`, ...; article `pageviews`, `visitors`, `engagementTime`), and made the Mission type name the `primaryMetric` a post is ranked by. The Analytics page has fixed columns (Views, Likes, Comments, Engagement) and `engagement` is computed by the core.

The second adapter for articles is Google Search Console, not Google Analytics: for SEO articles the useful numbers are `impressions`, `clicks`, CTR and the average `position`, which share almost nothing with a social post. With a closed vocabulary every such service needs a change of the core and of the page, and two services that share most of their metrics need a page for the rest. A search position is also better when it is lower, which a ranking by "highest wins" cannot say.

## Decision

- **An adapter declares its metrics in its manifest**, in the order of the columns of the Analytics page: `{ key, label, type, format, better?, derive? }`.
  - `type` is `counter` (a total that only grows: views, clicks) or `level` (a value that moves: a position, a rate).
  - `format` is `number`, `percent` or `duration`.
  - `better` is `higher` (default) or `lower`; it orients the ranking and the trend arrow.
  - `derive` is `{ sum: [keys], per: key }`: a figure computed from the adapter's other metrics (engagement is the interactions over the views). It is a `level`, it is never stored, and it is computed when displayed, for a post and for the totals (over the summed counters, never the mean of rates). Fixing a formula fixes the history.
- **The core stores a reading with the declared keys that are not derived and drops the rest.** It has no code per service, and the page has no fixed column.
- **A reading is a cumulative value for a `counter`**: since the publication, up to the last day the service reports. The page shows the variation since the previous Snapshot next to it ("+34 clicks"). A `level` is read over the adapter's own recent window (Search Console: the last 7 finalized days for `position`) and the page shows its trend. A cumulative value keeps every variation derivable; a window would not.
- **The ranking metric belongs to the adapter**: it declares `primary`, one of its metrics, used to sort the posts and for the top post of the page. The Mission type no longer names a metric: `analytics: { collect? }` only opts in. A Mission type without `analytics` is not measured.
- **An adapter declares its default reading delays** (`collect`, durations like `3d`). A Template's `collect` overrides them. Delays that fall on the same moment, once the adapter's `earliestDelayMs` is applied, become one reading.
- **A channel may be linked to several adapters.** The adapter of its Publisher stays the default link; others are added by hand. A Snapshot carries the id of the adapter that took it. The numbers of two adapters are never added or ranked together.
- **The Analytics page has a picker of the Project's adapters** and shows the chosen one's columns (the first four, a "Columns" menu for the rest), tiles and ranking. A Publication is on the page of an adapter when its Mission type opted in and its channel is linked to that adapter. The adapter shown first is the first one the Project activated. With one adapter there is no picker.
- **An adapter declares the secret of its connection and whether it needs a URL.** `secret: { label, kind: "text" | "json" }` (default a one-line text, as now). A `json` secret is shown as a multi-line field with a "Choose a file" button that reads the file in the browser and fills the field; the core checks that it is JSON with the fields the adapter names, and refuses it with a clear reason. It is stored where the key is stored today and the page only ever shows "configured". `needsUrl: false` makes the connection's URL optional for an adapter that has none to give (Search Console takes its property as an option).
- **The manifest has its own contract version.** This is contract 2; a manifest of contract 1 is refused as for any other version.
- **Search Console is the second adapter**, ahead of Google Analytics. It needs the page `url`, has the option `siteUrl` (`https://example.com/` or `sc-domain:example.com`), takes a service account key as a `json` secret (no connection URL), reads finalized data only, and reports about 3 days late, so `earliestDelayMs` is 3 days and `collect` is `[3d, 7d, 28d]`. Its metrics are `clicks` (primary), `impressions`, `ctr` (derived) and `position` (`better: lower`). Totals are per page; the queries behind a page are a separate piece of work.

## Considered options

- **Keep the closed vocabulary and add `impressions`, `clicks` and `position` to the article kind.** Rejected: every future service would need a change of the core, and the direction of a metric still has to be declared somewhere.
- **A closed vocabulary per kind plus a page per provider.** Rejected: two providers sharing 80% of their columns would still need a page for the rest.
- **The Mission type names the ranking metric.** Rejected: a Mission type does not know which adapter its channel will be linked to, and a metric the adapter does not have makes a link invalid for no real reason.
- **A reading is a window ("the last 7 days").** Rejected: it cannot be summed back into a total, while a cumulative value gives any variation.
- **Store derived figures such as engagement in the Snapshot.** Rejected: a corrected formula would not correct the history.
- **A file upload only for the service account key.** Rejected: pasting works everywhere and a file would need a path through Convex for a value read once. The file button only fills the field in the browser.
- **Keep the key as a one-line "API key" for every adapter.** Rejected: a service account key is about 2 KB over several lines and the field would be unusable and unverifiable.
- **A general expression language for `derive`.** Rejected: `sum` and `per` cover engagement and CTR; a new operation is a change of OpenGroow.

## Consequences

- The Analytics contract goes to version 2 (`ANALYTICS_CONTRACT_VERSION`). `METRIC_VOCABULARY`, `pickMetrics`, `metricKindOf` and the `kind` of `data/metrics.json` give way to the declaration in the manifest (`parseAnalyticsManifest`). `analytics-postiz` is republished with its metrics and its engagement formula.
- `primaryMetric` leaves the Mission type's `analytics` declaration (`packages/agent-templates`); the Template documentation, "Being measured", changes with it.
- The Analytics page reads the declaration instead of fixed names (`rankValue`, `engagementRate`, `totalsOf` in `analytics-figures.ts`) and gains the adapter picker, the "Columns" menu and the variation under a counter.
- Snapshots already stored keep their keys (`views`, `likes`, ...): no data migration. A key an adapter stops declaring stays stored and is no longer shown.
- A channel with several adapters needs its link stored as a list, and the Snapshot an adapter id. The first version may use one link; the data model must not forbid several.
- The Strategy Agent reads the declaration with the numbers, so it knows the meaning, the format and the direction of each metric. How it uses them is still not decided (ADR-078).
- The service account is added as a user of the Search Console property, and the 3-day delay and the `final` data state still have to be checked on a real property before the adapter ships.
- The connection stores the key in clear in Convex, as it does for every adapter. A service account key gives read access to Search Console and is no more sensitive than a Postiz key, but encrypting stored connection secrets is worth its own decision.
- Glossary: Metric, Counter and Level join Performance Snapshot.

## Appendix: a post measured twice

An article on `github:owner/blog` is linked to Search Console (by hand) and, later, to another adapter. Its Search Console series is `clicks 12, impressions 480, position 14.2` at 3 days, then `clicks 46, impressions 1,900, position 11.8` at 7 days. The page of Search Console shows `46 (+34)` clicks and `11.8` with an upward arrow, because a lower position is better. The page of the other adapter shows its own numbers for the same article; the two are never added.
