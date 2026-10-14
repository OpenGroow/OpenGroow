# ADR-016: Mission deletion — hard delete rather than archiving

**Status:** Accepted

### Context

The board accumulates cards for dead Missions (typically a pile of `failed` ones) that the user wants to be able to remove themselves via the UI. No deletion mechanism existed: `missions.ts` exposes neither delete nor archiving. Yet the glossary describes the Mission as a durable record (`number` "stable for life"), which raises the question: is removing a Mission about hiding it (soft-delete/archiving) or destroying it (hard delete)?

### Options considered

- **Archiving (soft-delete)** — a `deletedAt` field / "archived" status; the Mission is hidden from the board but kept and restorable. Recovery is possible, but adds a permanent retention concept and a filter on **every** mission query, for a record no one will claim (the driving need is to discard `failed` ones).
- **Hard delete** — actual destruction of the Mission row and cascade to its Runs.

### Decision

**Hard delete.** The mutation deletes the Mission and **cascades to its Runs** (destroying the aggregate through its root, via the `by_mission` index). Scope deliberately bounded:

- **Eligibility = no live Run on the Instance.** The boundary isn't the Mission's status but the state of its **Runs**: deletion is refused while a Run is `dispatching` (execution command being sent) or `running`, because its callback (Event/RunResult) would then reference a `missionId`/`runId` that no longer exists. A `pending` Run is **only** queued on the Convex side (the dispatcher hasn't claimed it, nothing has gone out to the Instance), and the cascade wins — so a **Mission stuck in `todo`** (Run left `pending`) **remains deletable**, which is the driving use case (cleaning up a stuck Mission). In practice: `doing` ⟺ Run `running` → always forbidden; `todo` ⟺ Run `pending`/`dispatching` → forbidden only for the brief `dispatching` instant. The mutation **re-validates this guard server-side** (re-fetch + ownership via `ownerIdFor` + scan of `dispatching`/`running` Runs + `doing` defense) — hiding the button in the UI (hidden only on `doing`) is merely a convenience, not the safety boundary.
- **Aggregate boundary respected**: the cascade stops at Runs. **Commands** and **Events** (Runtime Infrastructure context, Instance aggregate) are **not** touched — an append-only infra log; no query reads commands by mission, so orphaned rows are harmless.
- **Counter left intact**: `projectCounters` is never decremented; a gap in the `number` sequence is expected ("stable for life").
- **No domain event** emitted: hard delete with no trace, by choice.

UI: a delete button on the **board card** and on the **detail page**, visible only on eligible missions, behind a `window.confirm` confirmation (same pattern as `instance-danger-zone.tsx`).

### Consequences

- **Young platform, reversible choice toward more retention**: if a real recovery need arises, archiving can be added later. The reverse (starting with soft-delete) would impose a filter on all mission queries right away.
- Data is **truly lost** once deleted: no trash, no undo — hence the mandatory confirmation.
