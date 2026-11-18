# ADR-078: Analytics Adapters measure Publications, separately from Publishers

**Status:** Proposed

## Context

The Strategy Agent decides what to post next. It can only decide from data: how the posts OpenGroow published actually performed. Today a Publication ends at `published`; nothing reads what happened after. Postiz shows views, reach, likes, comments, shares and saves per post, so the service that published a post often can measure it. But not always: a blog article is published by a commit (GitHub, ADR-074) and measured by a web analytics service (Google Analytics). The service that publishes and the service that measures are two roles that sometimes share a service.

## Decision

- **An Analytics Adapter is a Project-level integration separate from the Publisher.** It is an installed hub package (official only, as for a Publisher, ADR-072) with its own connection and options per Project. A package may bring both: Postiz is a Publisher and an Analytics Adapter.
- **A channel is linked to at most one Analytics Adapter.** A channel whose Publisher is also an Analytics Adapter is linked to it by default. A channel with no link is "analytics unavailable", which is not "no data yet".
- **Each adapter declares the key it needs from a Publication** to find the post on its side. The key is free for now: Postiz needs the id the publishing service gave (`externalId`), Google Analytics the public URL of the page (`url`). An adapter that needs the id of a service only works with that service. The Publication records the URL as well as the id, so a reading does not depend on the Publisher later. The vocabulary of keys is closed when a third kind appears.
- **A Mission type opts in.** Next to `publish` it declares `analytics: { primaryMetric, collect? }`. `primaryMetric` is required and must belong to the metric vocabulary of the kind the Mission type publishes; `collect` defaults to `[1d, 3d, 7d]`, counted from the moment the Publication is `published`. A Mission type without it is not measured.
- **A Performance Snapshot belongs to one Publication, never to a Mission.** The numbers of two platforms cannot be added. Snapshots are only added, so a post's curve is kept. Each carries a `source` (`adapter` now, `manual` later, not built).
- **The metric vocabulary is closed per kind and owned by OpenGroow**, like the Publishable kinds: social `views`, `reach`, `likes`, `comments`, `shares`, `saves`; article `pageviews`, `visitors`, `engagementTime`. The adapter maps what its service returns (labels change, values are strings) and ignores the rest. Adding a metric is a change of OpenGroow, not of a Template.
- **When to read.** The Template says what it wants, the adapter says what it can (Google Analytics does not report before about two days), and the later of the two wins. No reading is tried before the Publication has the key the adapter needs.
- **Failure is local to the reading.** A Publication stays valid. A reading that fails is retried and shown as failed; an empty answer is "no data yet", not an error. A post the service no longer knows marks the reading `unavailable` with the reason and stops further attempts, keeping earlier Snapshots. A retried Publication that creates a new post starts new Snapshots without erasing the old ones.
- **Scope of V1.** Only Publications made by OpenGroow are measured; importing posts that existed before is out. The first adapter is Postiz. Google Analytics is the second. How the Strategy Agent reads the Snapshots is not decided here: only that they are readable by an Agent.

## Considered options

- **Make analytics a required function of every Publisher.** Rejected: the GitHub Publisher has nothing to measure, and an empty answer would hide "not supported" behind "no data".
- **A single module that publishes and measures.** Rejected: it cannot express a blog published by GitHub and measured by Google Analytics.
- **Match posts to measures by caption or date.** Rejected: fragile, and it is the problem `findPost` already works around. A key the Publication carries is exact.
- **Store Postiz's metric labels as they come.** Rejected: the Strategy would need to know each service's words. A closed vocabulary keeps the page and the Agent free of per-service code (ADR-020).
- **Land measures as Sources (ADR-051).** Rejected: a Source is something an Agent saw outside; a reading of our own post is not.

## Consequences

- The Publisher contract does not change; the Analytics Adapter has its own contract in the SDK, with its own version. Postiz and the hub's `capabilities`-style data need a release to declare it.
- The Postiz post-analytics endpoint takes a `postId` the docs do not define (Postiz id or release id) and lists only "likes, comments, shares, impressions, etc."; it must be called on a real post before the plugin is written. Postiz' public API limit (`API_LIMIT`) is instance configuration and is not a design constraint.
- Rematching by URL needs the URL normalized on both sides (no tracking parameters, no trailing slash).
- Two new terms enter the glossary: Analytics Adapter and Performance Snapshot.

## Appendix: two examples

**A reel on Instagram, Postiz.** The channel `instagram:@account` is linked by default to Postiz. The Publication holds `externalId: abc123` and the post URL. At 1, 3 and 7 days the adapter asks `GET /analytics/post/abc123?date=7` and the core stores a Snapshot `views 146, reach 116, likes 2, comments 0, shares 0, saves 0`.

**An article, GitHub and Google Analytics.** The channel `github:owner/blog` is linked by hand to Google Analytics (a property and the host `blog.example`). The Publication holds the commit sha and `https://blog.example/blog/my-slug`. At 2 days the adapter normalizes the URL, reads the page path `/blog/my-slug` and the core stores `pageviews`, `visitors`, `engagementTime`.
