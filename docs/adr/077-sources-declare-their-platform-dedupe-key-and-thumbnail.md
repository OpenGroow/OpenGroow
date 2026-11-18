# ADR-077: Sources declare their platform, dedupe key and thumbnail

**Status:** Proposed (amends ADR-076)

## Context

ADR-076 put knowledge about Instagram and TikTok into generic code: the hosts and the placeholder rule of `source_thumbnails`, the post rules of `source_origin` (`/p/`, `/reel/`, `/video/`, `/photo/`), `platformOf` (a test on the `sourceId`), and in the dashboard the two logos and `formatOf`. A Template Source Agent for another platform got no thumbnail, no dedupe and no icon until the core was edited in several files, while the manifest's `sources[]` already declares everything else about a Source (ADR-051).

## Decision

- **A Source declaration may carry a `platform`.** It is data: `name` (shown, and the prefix of the dedupe key), `icon` (a png, webp, jpeg or svg data URI shipped in the manifest, the same rule as a Publisher's icon, ADR-075), `pageHosts` (the domains of its pages), `originPattern` (a regex over `host/path` with exactly one capture group: the post's identity), `thumbnail` (`"og-image"`, a strategy named by the manifest) with its `imageHosts`, and `mediaLabels` (the platform's word for a media kind, "Reel" for a video).
- **Scraping stays code, chosen by name.** `thumbnail: "og-image"` selects the code that reads a page's `og:image` (crawler user agent, placeholder images). A new way to find an image is a new strategy name, not manifest data.
- **Generic code only reads the declaration.** `originKeyOf(origin, platform)` gives `<name>/<capture>` for a page of a declared host that the pattern recognises, and the page itself (`host/path?query`) otherwise. `source_thumbnails` fetches a page only when the Source's Template declares a `thumbnail` strategy and the origin is on one of its `pageHosts`, and accepts an image only from its `imageHosts`. The dashboard reads the logo and words from `source_platforms.forInstance`. No module names Instagram or TikTok.
- **The validator is strict, because a manifest can come from anywhere.** Hosts must be domains (no scheme, port, IP address, `localhost` or single-label host), so a Template cannot point the server's fetches at an internal address. An `originPattern` is capped in length, must compile and have exactly one capture group, and only ever runs on a declared page host, on a capped input. `thumbnail` requires `imageHosts`.
- **No fallback to built-in rules.** A Source whose Template does not declare a platform has no logo, no thumbnail and a page-level dedupe key; one whose Template is gone gets no new thumbnail either. The Instagram and TikTok rules move into the declarations of their Templates.

## Considered options

- **Keep the rules in code and add a platform registry there.** Rejected: that is the same edit in the core for every platform.
- **A logo name from a list in the dashboard.** Rejected: the logo then lives in the core. A data URI ships with the Template, like a Publisher's.
- **Scraping steps in the manifest.** Rejected: a manifest that describes how to fetch and parse is a script, and its hosts are an attack surface; naming a strategy keeps the code reviewed.

## Consequences

- Dedupe keys change shape (`instagram/<code>`, `tiktok/<id>` instead of `instagram.com/p/<code>`, `tiktok.com/<id>`): a post ingested before this change is not matched by a later capture of it. Sources without `originKey` were already not matched (ADR-076).
- A Template installed before this change keeps working but loses the thumbnail, the logo and the dedupe key until it declares a `platform`.
- Amends ADR-076 on the thumbnail: it is no longer limited to Instagram and TikTok, but to the pages and hosts a Template declares.
