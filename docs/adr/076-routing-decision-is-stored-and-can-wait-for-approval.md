# ADR-076: The routing decision is stored on the Source and can wait for human approval

**Status:** Proposed

### Context

`routing` (ADR-052) picks the producing Mission type for the day's winning Source. Until now the choice was invisible and final: `settleRoutingRun` validated the result and created the production Mission in the same mutation. The only trace was `job.lastSummary`, overwritten by the next run. An operator could not see which producer was chosen, why, or which others were eligible, and the first human checkpoint was the finished production, at `to_validate`.

### Decision

- A Source carries its routing decision in `sources.routing`: the chosen target (`templateId`, `missionType`, `label`, `agentName`), the Mission `payload` as it will be created, the routing Agent's `rationale` (the RunResult summary), the `candidates` that were eligible, and a `state`: `proposed`, `approved` or `rejected`, with who decided (`agent` or `user`).
- The Source routing Job has a `config.reviewRouting` flag. When off (the default), nothing changes for production: the Mission is created at once and the decision is recorded as `approved` by the `agent`. When on, `settleRoutingRun` stores the decision as `proposed` and creates no Mission. The Source stays `selectedAt`, so it is not ranked again.
- `approveRouting` creates the production Mission from the stored decision, optionally with an edited `publish`. `rejectRouting` discards it. Both are owner-scoped mutations.
- The Sources page gets a production queue above its list, with two columns: **Ideas** (scored, unpicked Sources, best score first) and **To route** (the `proposed` decisions). They stay on the Sources page, not on the Missions board, so the board does not grow: once a Source is routed and approved, its production Mission appears in "To do".

### Consequences

- `reviewRouting` applies to a forced production too (Produce on an idea): the routing choice is still shown before the Mission starts.
- A `rejected` Source is never ranked again; there is no way back to Ideas yet.
- Changing the target on a proposal is not supported yet: another Mission type may need a different payload, so it needs a routing run constrained to that target.
- `sources.routing.payload` of a `create_reel` already carries `observationId` (ADR-071).
