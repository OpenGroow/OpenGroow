# ADR-033: Shared bounded-retry primitive across Run/Node/External-Job reliability logic, no unified state machine

**Status:** Accepted

### Context

Issue #295 flagged that pairing/reconciliation reliability logic keeps accreting via incident-driven patches: `decideReconciliation`'s salvage-read grace period (`mission_dispatcher/reconciliation.ts`, see ADR-032), `openclaw-connect`'s Node Identity rotation cap (`consecutiveInvalidSignatureRotations` / `hasExhaustedDeviceSignatureRotations` in `node-run.ts`), and the External Job retryable-failure budget (`retryableFailureCount` / `MAX_RETRYABLE_JOB_FAILURES`, `mission_dispatcher/external_job_polling.ts`) are three independently-written instances of the same shape: a counter, a bound (time-based or count-based), and an explicit terminal decision once the bound is hit. The issue asked whether these three — plus a fourth case, `use-connect-wizard.ts`'s stale `requestId` — should collapse into a single coherent "uncertain state" state machine.

### Options considered

- **Single unified state machine** covering all four cases (Run, Node Identity, External Job, requestId) as instances of one generic "waiting to find out what happened" concept.
- **Shared low-level primitive + case-specific logic, no domain unification** — factor out only the common counter/bound/terminal-decision skeleton as a pure helper; leave the domain-specific parts (what triggers a retry, what the terminal decision means, any pre-retry diagnosis) local to each call site.

### Decision

**Shared low-level primitive, not a unified state machine.** The four cases are not the same domain concept: Run salvage-read is genuine observation lag (the file may still land); Node Identity rejection needs a diagnosis step first (clock skew can never be fixed by rotating identity — rotating without diagnosing was the actual bug, not the retry count); the External Job budget is surfaced to the Agent as remaining attempts, not just retried silently; and the `requestId` case isn't an "uncertain state" at all — it's a stale-read bug fixed by refetching immediately before use, no counter or bound involved.

Only Run salvage-read, Node Identity rotation, and the External Job retryable-failure budget share the real technical shape. A new package (`packages/reliability`) will host a pure `decideBoundedRetry(state, event) → { retry } | { terminal, reason }`-shaped helper (exact signature TBD at implementation time, but must return enough for a caller to surface remaining-attempts, per the External Job case) that all three fold their bookkeeping through. Node Identity's clock-skew diagnosis and the `requestId` refetch-before-use fix stay local — they are not instances of the shared primitive, just neighbors in the same problem area.

### Consequences

- `apps/convex` and `apps/openclaw-connect` both take a dependency on the new `packages/reliability` package — the first shared package between them.
- Each of the three call sites still owns its own retry predicate and terminal decision; only the counter/bound bookkeeping is deduplicated. This deliberately avoids forcing Run/Node/External-Job into one shared status vocabulary they don't actually share.
- The `requestId` staleness fix and the Node Identity clock-skew diagnosis are separate, smaller pieces of work — not blocked on `packages/reliability` and not expected to use it.
- A future fifth incident in this area should first be checked against `decideBoundedRetry`'s shape before writing a fourth bespoke counter — if it doesn't fit, that's a signal the primitive's contract needs to evolve, not that a fourth copy is warranted.
