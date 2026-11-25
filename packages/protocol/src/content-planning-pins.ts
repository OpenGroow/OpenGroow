// What OpenGroow pins on a Content Planning Run (ADR-086): the Planning period
// and the remaining quantity per format. Pure, so the dispatcher, the Run
// persistence and the dashboard all count the same way.

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of an instant, in UTC. */
export function utcDateOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The Planning period of a Run started at `now`: from the day after, `planningDays` inclusive days, UTC. */
export function planningPeriodOf(now: number, planningDays: number): { periodStart: string; periodEnd: string } {
  return { periodStart: utcDateOf(now + DAY_MS), periodEnd: utcDateOf(now + planningDays * DAY_MS) };
}

/** What is still to plan for a format: `max(0, target - existing)`. */
export function remainingOf(target: number, existing: number): number {
  return Math.max(0, target - existing);
}
