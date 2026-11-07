# ADR-069: A generic Publisher owns publication; Agent Templates return a Publishable in a unified format

**Status:** Accepted

## Context

Postiz publishing config (channels, boards, credentials) is duplicated in every MCP (`demo-video-mcp`, `seo-mcp`, the visual-social tools), and each MCP calls Postiz itself. Adding a service, or a new kind of deliverable, means touching every MCP. ADR-034 moved that configuration into each MCP's own dashboard, which made the duplication permanent.

## Decision

- **A Publisher is a Project-level integration** (one adapter plus its per-Project config), with its own dashboard page. V1 has a single adapter, Postiz. The concept is generic so a second service is a new adapter, not a new architecture.
- **Agents never publish.** An Agent Template returns a **Publishable** in the RunResult's Artifact (`publishable` field). OpenGroow publishes on the human `publish` action of the review, or automatically with `autoPublish`.
- **The unified format is a closed set of kinds owned by OpenGroow**: `video`, `image`, `carousel` in V1, each with a fixed schema, plus a free `metadata` the adapter reads if it understands it. Adding a kind is a product change, not a Template declaration. This differs from ADR-051 on purpose: a Source is only described, a Publishable is interpreted by an adapter, so there must be no guessing.
- **References only** (media URLs, ids at the producing service), never content (ADR-010 unchanged).
- **The Template manifest declares**, per Mission type, only the kind it produces: `publish: { kind }`. It lists no destination (see the amendment below). Convex validates the Publishable against the kind and returns errors to the Agent (same approach as ADR-051's `analysisSchema`).
- **Publish targets are the channels of the Project's Publisher.** A Mission or Schedule payload carries `publishTargets` (the keys of one or several channels of the Publisher) and an optional `publishAt`; the human chooses them when creating the Mission or Schedule and can change both at review. The Publisher lists the service's channels (Postiz channels are discovered through its API and picked from a menu), generates the key of each (always `<platform>:<handle>`, for example `instagram:love_youmake`; a channel without a handle or with an already-added handle is refused) and holds the service-specific settings per channel. None of that reaches the unified format. There is no default: no channel chosen means `publish` is disabled.
- **A Publication** tracks each (Mission, target): `pending`, `scheduled`, `published`, `failed`, with external URL, scheduled date and error. A Mission is `done` when all its Publications are `published`; a failed one is retried alone. Status is followed by Convex polling, as for External Jobs.
- **No activation gate** (unlike ADR-034). An unknown or unmapped channel, or no channel chosen, disables `publish`; under `autoPublish` an unknown or unmapped channel makes the Publication `failed` with an explicit message (the Mission stays `approved`), and no channel at all fails the Mission with an explicit message. A failed Publication is retried after the Publisher is fixed.
- **Migration is by opt-in, template by template.** A Mission type that declares `publish` in its manifest no longer publishes itself: its instructions stop calling the MCP's publishing tools and the MCP stops receiving publishing settings. No dual-write. Templates not migrated behave as today.

## Consequences

- Amends ADR-034: the "Postiz channels" configuration leaves the MCP dashboards and moves to the Publisher. The rest of ADR-034 (`apiKey`, `statusCheck`) is unchanged.
- Amends ADR-024: Pinterest board routing becomes a Publisher channel (with its board in the channel settings) chosen in the Schedule payload instead of a `pinterestBoardId` passed to the MCP.
- ADR-010 is confirmed. `article` publishing (GitHub, from `seo`) stays in `seo-mcp` and is out of V1.
- The review's `publish` action gets a real executor in OpenGroow instead of depending on the MCP.
- New Convex state: Publisher config per Project and Publications, plus the Artifact `publishable` field in the RunResult contract.

## Amendment: destinations are chosen per Mission or Schedule, not declared by Templates

**Decision (user, PR #25).** A Template does not list Publish targets. Its manifest declares only the kind it produces (`publish: { kind }`); `targets` is rejected as an unknown key. Where content goes is chosen when creating a Mission or a Schedule (and editable at review) by picking one or more channels of the Project's Publisher, never by typing a name.

**Why.** The destination is a property of the Project (which accounts it has connected), not of a Template. A Template that names `instagram` or `pinterest:recipes` forces the author to guess the Project's channel names, makes every Project invent matching aliases, and fails late (at publish time) when they differ. Picking from the Publisher's actual channels removes the alias, the "declared targets" check and the "first declared target" default.

**Consequences.** The stored key of each channel is generated by the Publisher (`addChannel`) and is internal. The mutations that save a Mission or Schedule payload check only that each key exists on the Publisher (they have no Template registry); mapping and the API key are checked when publishing. Existing data keeps whatever keys it has.

## Amendment: Publishable format hardening

**Decision.** (1) The Publishable gains optional `link` (Pinterest pin destination), `altText` (image alt) and `tags` (YouTube); the adapter forwards them, and `coverUrl` as a YouTube thumbnail, where Postiz supports them and ignores them silently elsewhere. Required fields and strictness are unchanged. (2) The manifest `publish` gains `require`: optional fields of the kind the Template guarantees, enforced on the RunResult with a per-field error through the existing retry path and listed in the Agent's `context.md`; it can only tighten the format. (3) The manifest `publish` gained `media`, a map from a media field to a path in the MCP tool output (replaced by `resource`, see the amendment below).

**Status of `media`.** Removed (issue #26): it was never applied and could not be (OpenGroow cannot read the output of a tool the Agent called during its Run). Replaced by `publish.resource`, below; a manifest still declaring `media` is rejected with a migration message.

## Amendment: retry without duplicate posts

Postiz has no idempotency key, so "post accepted, connection dropped, Retry" would publish twice. A Publication is now `submitting` before `POST /posts`; a failure that does not prove a rejection (network, timeout, 5xx, unreadable answer) makes it `uncertain`, not `failed`; only a 4xx is `failed`. Retrying an `uncertain` Publication (or a `failed` one with a stored attempt window and no post id) first reconciles through the adapter-agnostic `findPost` (same channel, same caption, creation or publish date in the attempt window): a match is attached and nothing is sent, no match sends once, an unreadable listing keeps it `uncertain`. Uploaded media ids are stored on the Publication and reused. Only one caller can move a row to `pending`/`submitting` (serialized mutations), so a double click sends once. `uncertain` blocks the Mission from `done`.

A past `publishAt` is rejected when a human creates or edits a Mission, Schedule or review date; a Mission spawned by a Schedule whose absolute `publishAt` went stale still publishes immediately.

## Amendment: channel / content-kind capabilities

Compatibility between a channel's platform and the Publishable `kind` belongs to the publishing service, so it lives behind the adapter-agnostic Publisher, not in Templates or the dashboard. It is **data**, not code: `packages/publisher-postiz/data/capabilities.json` (`schemaVersion: 1`, `{ adapter, platforms: { <service>: { video|image|carousel: supported|uncertain|unsupported, reasons } } }`), read by a pure `capabilityOf(adapterId, service, kind)` with no per-platform branch; unknown platforms are `uncertain`. `unsupported` (set only when the service docs say so) is refused server-side at Mission/Schedule creation and edit, `setTargets` and publish time, and disabled with its reason in the dashboard; `uncertain` is allowed with a visible warning.

This JSON is one of the two data files of a Publisher plugin (ADR-070: an isolated code module with a function contract, a workspace package now, a hub package later). The adapter and its data now live in `packages/publisher/postiz` (hub); the core in `apps/convex/publisher/` only holds the plugin registry. No loader of external plugins exists.

## Amendment: MCP output contract is a recommendation

The strict contract is OpenGroow's `artifact.publishable`, validated per `kind` (`require` can tighten it). MCP output names (`videoUrl`, `coverUrl`, `imageUrl`, `slideUrls`) are a documented recommended convention, not a requirement: an MCP with another shape keeps working because the Agent translates. For a synchronous MCP, the Agent translates. For an asynchronous one the declared `publish.resource` applies.

## Amendment: `publish.resource` for asynchronous MCPs

A terminal External Job used to write the RunResult without Agent text and no `publishable` was ever produced, and a polling result need not carry the media (MoneyPrinterTurbo's `get_run_status` returns only `{ runId, status, output: { taskId } }`). The contract for a media-producing MCP is now produce / status / get: a launch tool returning a job id, a status tool (polled as before) and a tool returning the media with the recommended names. The Mission type declares `publish.resource: { tool, idArg?, map? }` (`idArg` defaults to `runId`; `map` maps other names with the former `media` path syntax).

The Agent writes only the text part of the `publishable` in its `in_progress` RunResult (stored on the Run with the job pointer; a media URL there is rejected, and its absence is a retryable error when `resource` is declared). On `completed`, OpenGroow calls `resource.tool` once, merges the media (Agent text fields are never overwritten), validates the result per kind and `require`, and completes the Run (`needs_human_review` or `success` per the job contract). A failing tool, a missing or invalid media fails the Run with a per-field message and keeps no partial `publishable`; an unreachable MCP leaves the Run `awaiting_job` for the next tick. The call happens only on the path that completes the Run, so a replayed poll does not repeat it. OpenGroow holds no URL template and talks to the MCP only through MCP tools (HTTP remains for the `activationUrl` and the public media URLs fetched by the browser and Postiz); the URL is frozen at the end of the job and must stay valid until publication. For a Mission type that declares `publish`, the review shows the media from the `publishable` and no longer fetches `review.path`.
