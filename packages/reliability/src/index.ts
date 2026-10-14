export type BoundedRetryState = {
  attempts: number;
};

export type BoundedRetryEvent = {
  maxAttempts: number;
};

export type BoundedRetryDecision =
  | { retry: true; nextState: BoundedRetryState; attemptsRemaining: number }
  | { terminal: true; reason: "bound_exceeded"; attemptsUsed: number };

export function decideBoundedRetry(
  state: BoundedRetryState,
  event: BoundedRetryEvent,
): BoundedRetryDecision {
  const attempts = state.attempts + 1;
  if (attempts > event.maxAttempts) {
    return { terminal: true, reason: "bound_exceeded", attemptsUsed: state.attempts };
  }
  return {
    retry: true,
    nextState: { attempts },
    attemptsRemaining: event.maxAttempts - attempts,
  };
}

/**
 * Narrows a `BoundedRetryDecision` to its `retry` branch. `retry`/`terminal`
 * are the only keys the two branches carry (per ADR-033's sketch), so this
 * (and `isTerminalDecision` below) is the one place callers need to know
 * that — every call site narrows the same way instead of repeating the
 * `"retry" in decision` / `"terminal" in decision` check inline.
 */
export function isRetryDecision(
  decision: BoundedRetryDecision,
): decision is Extract<BoundedRetryDecision, { retry: true }> {
  return "retry" in decision;
}

export function isTerminalDecision(
  decision: BoundedRetryDecision,
): decision is Extract<BoundedRetryDecision, { terminal: true }> {
  return "terminal" in decision;
}
