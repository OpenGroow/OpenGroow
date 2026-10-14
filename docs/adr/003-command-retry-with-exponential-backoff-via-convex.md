# ADR-003: Command retry with exponential backoff via Convex Scheduler

**Status:** Accepted

### Context

Commands sent to OpenClaw via the Broker can fail (Broker unreachable, OpenClaw instance not connected). We need a robust retry policy with no external dependency (no BullMQ, no Redis).

### Decision

Retry is handled entirely by the Convex Scheduler in `commands_node.dispatch`:

- **Exponential backoff**: `min(1000ms × 2^(attempts-1), 60_000ms)` — 1s, 2s, 4s, 8s… capped at 60s.
- **Retry cases**: Broker unreachable (502/timeout) or instance not connected (409).
- **Definitive failure**: any other HTTP code moves the command to `status: "failed"`.
- **Idempotence**: each command is identified by its Convex `_id`, so OpenClaw can deduplicate.

### Consequences

- No external dependency for retry — the logic is co-located with the Convex scheduler.
- The number of attempts is not explicitly capped (unless the Broker responds definitively with a non-retriable error code).
- If a command stays stuck in retry for a long time (e.g. instance powered off), it remains in `status: "queued"` and keeps consuming scheduler slots.
