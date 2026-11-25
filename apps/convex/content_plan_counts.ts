import type { MutationCtx } from "./_generated/server.js";

// The approved Planned Contents of a Planning period, counted by format (ADR-086). Quotas are computed from this, so it
// must never under-count: it streams the whole index range and refuses when the range is beyond what one transaction
// can safely read, instead of returning a partial count that would overstate what remains.

/** The most approved contents counted in one transaction; more than this and the count is refused, never truncated. */
export const MAX_COUNTED_CONTENTS = 4_000;

/** How many of `items` there are per format (`kind`). */
export function countByKind(items: Iterable<{ kind: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { kind } of items) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return counts;
}

export async function approvedCountsByKind(ctx: MutationCtx, instanceId: string, periodStart: string, periodEnd: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let total = 0;
  const approved = ctx.db
    .query("plannedContents")
    .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", instanceId).eq("status", "approved").gte("plannedAt", periodStart).lte("plannedAt", periodEnd));
  for await (const content of approved) {
    if (++total > MAX_COUNTED_CONTENTS) throw new Error(`More than ${MAX_COUNTED_CONTENTS} approved contents in the period ${periodStart} to ${periodEnd}: shorten the Planning period.`);
    counts.set(content.kind, (counts.get(content.kind) ?? 0) + 1);
  }
  return counts;
}
