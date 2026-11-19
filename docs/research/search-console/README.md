# Google Search Console check on a real property (#105)

Checked on 2026-11-19 against a real domain property (`sc-domain:example.com`) with a service account, no interactive sign-in. The files in `fixtures/` are the recorded answers (request + status + response) for the Search Console adapter tests (#106). They hold site statistics only, no credentials.

## Service account setup

1. Google Cloud project: enable **Google Search Console API** (`searchconsole.googleapis.com`). Until it is enabled the API answers `403 SERVICE_DISABLED`; it can take a few minutes to propagate.
2. Create a service account (no Cloud IAM role needed) and a **JSON key** for it. The key is the connection's secret.
3. In Search Console, Settings > Users and permissions > Add user: the service account's `...iam.gserviceaccount.com` address, permission **Restricted** (read only). The property then shows up as `siteRestrictedUser`.
4. Authentication: sign a JWT (RS256) with the key, scope `https://www.googleapis.com/auth/webmasters.readonly`, exchange it at `https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`). Works with no browser step.

## What was settled

- **Property formats.** `GET /webmasters/v3/sites` lists what the account can read. Here the property is a **domain** property, `sc-domain:example.com`. The URL-prefix form (`https://example.com/`) is not a separate property of this account and was **not** tested on a real property. The adapter must take the property as an option, exactly as Search Console names it, and url-encode it in the path.
- **Reporting delay and `final` state.** With `dataState: "final"` the last day returned was `today - 2` (2026-11-17 on 2026-11-19). With `dataState: "all"` the days up to today are returned, today being partial (59 impressions against about 4,400 for a full day) and yesterday not yet final. So reading finalized data means a window that ends two days ago; the declared `earliestDelayMs` of about 3 days leaves a safe margin.
- **Cumulative per-page read.** One call with `dimensions: ["page"]` and a `dimensionFilterGroups` filter `page equals <public URL>` over `[publication day, today - 2]` returns one row with `clicks`, `impressions`, `ctr`, `position` (`page-cumulative.json`). Without any dimension the same filter returns a single row with no `keys` (`page-totals-nodim.json`). The page URL must be the exact public URL; locale pages are separate pages (`/es/blog/...`).
- **Position over recent days.** The same call over the last 7 finalized days gives the average position for that window (`page-position-7d.json`: 8.35, against 7.99 over the whole range). The `position` of Search Console is an average where lower is better.
- **No data.** A page the service does not know, or a range with no finalized data, answers **200 with no `rows` key** (`page-unknown.json`, `future-range.json`). It is "no data yet", not an error.
- **Rates.** `ctr` comes back as a ratio (0.0051 = 0.51 %). The adapter derives CTR from summed clicks over impressions anyway (ADR-079).

## Not covered

- URL-prefix property on a real property.
- History limits (the requests started 40 days back; Search Console keeps about 16 months).
- Quota behaviour.
