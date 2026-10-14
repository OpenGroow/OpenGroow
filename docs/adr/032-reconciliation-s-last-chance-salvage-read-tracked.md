# ADR-032: Reconciliation's last-chance salvage read tracked via a dedicated command id, not a boolean flag

**Status:** Accepted

### Context

`decideReconciliation` (`mission_dispatcher/reconciliation.ts`) can mark a `running` Run failed with `file_missing` if the workspace outputs file still isn't readable once the salvage grace period (`salvageTimedOut`) elapses. An incident (run `k97ejvep5pvrthwygzk6tde3b98az5bb`) showed this can misfire: the cached `readResult` was a stale not-found taken moments before the Agent's output file actually landed, straddling the grace-period boundary — a genuinely successful run got marked failed. The fix is to give exactly one more, final, fresh read a chance before concluding failure. That "exactly one more" needs state to avoid looping `enqueueRead` forever if the final read also comes back not-found.

### Options considered

- **Boolean flag** (`finalReadAttempted: true`) — the final read would reuse the existing `resultReadCommandId`/`readResult` slot, same as every prior retry. Simpler (no new schema field), but the flag only records *that* a final read happened; the shared slot's `readResult` is not structurally tied to *which* read produced it, so distinguishing "the final attempt's outcome" from "a still-stale prior outcome" relies on getting the read/flag ordering right rather than on the data shape itself.
- **Dedicated `finalReadCommandId`** — a second command id, separate from `resultReadCommandId`, with its own `finalReadResult`.

### Decision

**Dedicated `finalReadCommandId`.** `runs.finalReadCommandId` (schema) is set once, the first time `salvageTimedOut` is true and the cached `readResult` is a not-found — mirroring the existing `dispatchCommandId`/`resultReadCommandId` pattern of one command id per logical step rather than flags layered on a shared slot. `decideReconciliation` waits on `finalReadResult` once `finalReadCommandId` is set, and treats its outcome (success, still not-found) as final — no further retries. Its presence *is* the proof the last chance was taken, and its result can never be confused with an earlier, possibly-stale `readResult`.

### Consequences

- One extra optional column on `runs`, plus a parallel `finalReadResult` lookup in `loadReconcileState` and a `setFinalReadCommandId` mutation — mirrors the existing `resultReadCommandId` plumbing, no new pattern introduced.
- The caller (`mission_dispatcher_node.ts`) must re-derive, from the same snapshot fields `decideReconciliation` used, whether a given `enqueueRead` decision is the final-chance dispatch (routing it to `setFinalReadCommandId`) or an ordinary one (`setResultReadCommandId`) — the decision object itself doesn't carry that distinction.
- `commands`/`events` rows may reference a deleted `missionId`: any consumer of these logs must tolerate a missing Mission (never assume an Event's `missionId` still resolves).
