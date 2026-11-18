# ADR-076: The routing decision is stored on the Source and can wait for human approval

**Status:** Proposed

### Context

`routing` (ADR-052) picks the producing Mission type for the day's winning Source. Until now the choice was invisible and final: `settleRoutingRun` validated the result and created the production Mission in the same mutation. The only trace was `job.lastSummary`, overwritten by the next run. An operator could not see which producer was chosen, why, or which others were eligible, and the first human checkpoint was the finished production, at `to_validate`.

### Decision

- A Source carries its routing decision in `sources.routing`: the chosen target (`templateId`, `missionType`, `label`, `agentName`), the Mission `payload` as it will be created, the routing Agent's `rationale` (the RunResult summary), the `candidates` that were eligible, and a `state`: `proposed` or `approved`, with who decided (`agent` or `user`).
- The Source routing Job has a `config.reviewRouting` flag. When off (the default), nothing changes for production: the Mission is created at once and the decision is recorded as `approved` by the `agent`. When on, `settleRoutingRun` stores the decision as `proposed` and creates no Mission. The Source stays `selectedAt`, so it is not ranked again.
- The Sources page has two tabs. **Ready** lists the Sources in the `Scored` stage (analysed, scored, not picked yet), best score first; **All** is the exhaustive list. Each Ready row shows the format (e.g. "Instagram Reel"), the score, a **Routed to** choice and a **Produce** button. The same Select mode as All (checkboxes, then one permanent deletion) lets the user discard Sources the router proposed badly.
- **Routed to** shows the producer Produce will use: the one the user picked by hand (`sources.routeTo`), else the router's `proposed` decision, else "Auto" (the router decides when Produce is pressed). The choices are the current candidates (`source_routing.listTargets`).
- **Produce** (`forceProduction`) is the human step. A valid `proposed` decision becomes the production Mission at once. Otherwise a routing Job is queued for this Source, constrained to the producer picked by hand if any (`forcedTarget`): the router then only writes that producer's payload. A forced run is never held for approval, since Produce is the approval. The Mission starts in "To do" on the Missions board, which is unchanged.

### Consequences

- Only the Top-1 of the day is routed by the router unprompted, so most Ready rows show "Auto" until Produce is pressed. Predicting a producer for every scored Source would need one routing run per Source.
- A Source has no thumbnail stored, so the row shows its family glyph.
- Changing the producer after a `proposed` decision discards that proposal: Produce routes again to the new producer.
- `sources.routing.payload` of a `create_reel` already carries `observationId` (ADR-071).
