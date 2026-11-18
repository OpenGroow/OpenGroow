# ADR-076: The routing decision is stored on the Source and can wait for human approval

**Status:** Proposed

### Context

`routing` (ADR-052) picks the producing Mission type for the day's winning Source. Until now the choice was invisible and final: `settleRoutingRun` validated the result and created the production Mission in the same mutation. The only trace was `job.lastSummary`, overwritten by the next run. An operator could not see which producer was chosen, why, or which others were eligible, and the first human checkpoint was the finished production, at `to_validate`.

### Decision

- A Source carries its routing decision in `sources.routing`: the chosen target (`templateId`, `missionType`, `label`, `agentName`), the Mission `payload` as it will be created, the routing Agent's `rationale` (the RunResult summary), the `candidates` that were eligible, and a `state`: `proposed` or `approved`, with who decided (`agent` or `user`).
- The Source routing Job has a `config.reviewRouting` flag. When off (the default), nothing changes for production: the Mission is created at once and the decision is recorded as `approved` by the `agent`. When on, `settleRoutingRun` stores the decision as `proposed` and creates no Mission. The Source stays `selectedAt`, so it is not ranked again.
- The Sources page has two tabs. **Scored** lists the Sources in the `Scored` stage (analysed, scored, not picked yet), best score first; **Other** lists the Sources that are neither on the Scored tab nor picked for production (processing, not scored yet, failed), with a short status filter (All, Processing, Not scored yet, Failed). A Source picked for production is followed on the Missions board and is not listed. Each Scored row shows the format (e.g. "Instagram Reel"), the score, a **Routed to** choice and a **Produce** button. The same Select mode on both tabs (checkboxes, then one permanent deletion) lets the user discard Sources the router proposed badly.
- **Routed to** shows the producer Produce will use: the one the user picked by hand (`sources.routeTo`), else the router's `proposed` decision, else "Auto" (the router decides when Produce is pressed). The choices are the current candidates (`source_routing.listTargets`).
- **Produce** (`forceProduction`) is the human step. A valid `proposed` decision becomes the production Mission at once. Otherwise a routing Job is queued for this Source, constrained to the producer picked by hand if any (`routeTo`, read when the Job reserves the Source): the router then only writes that producer's payload. A forced run is never held for approval, since Produce is the approval. The Mission starts in "To do" on the Missions board, which is unchanged.

### Consequences

- Only the Top-1 of the day is routed by the router unprompted, so most Ready rows show "Auto" until Produce is pressed. Predicting a producer for every scored Source would need one routing run per Source.
- A Ready row shows the page's own image. It is the `og:image` of the Source's Instagram or TikTok page, read with a link-preview crawler user agent and copied into Convex storage by `source_thumbnails` (the CDN URLs are signed and expire within days). It is fetched when the Scored tab shows a Source that never had one, and is best effort: any other host, a blocked request or a page without an image keeps the family glyph. This is an unofficial scrape: it may stop working or be blocked from a server IP.
- Changing the producer after a `proposed` decision discards that proposal: Produce routes again to the new producer.
- `sources.routing.payload` of a `create_reel` already carries `observationId` (ADR-071).
