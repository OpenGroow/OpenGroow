// `publishAt` (ADR-069): an optional epoch-ms date carried by a Mission or
// Schedule payload. Absent = publish immediately. Kept free of Convex imports so
// missions.ts, schedules.ts and publications.ts can all share it.

/** When the human wants the post out, from `payload.publishAt`. A missing,
 * invalid or already-past date means "publish immediately". */
export function effectivePublishAt(payload: unknown, now: number): number | undefined {
  const at = (payload as { publishAt?: unknown } | null | undefined)?.publishAt;
  return typeof at === "number" && Number.isFinite(at) && at > now ? at : undefined;
}

/** Rejects a `publishAt` that is present but not a finite epoch-ms number, or
 * that is already past. Only for creation/edit by a human: a Mission spawned
 * from a Schedule whose absolute `publishAt` went stale publishes immediately
 * (`effectivePublishAt`) instead of failing the spawn. `unchanged` lets an
 * edit keep a stale value it did not touch. */
export function assertValidPublishAt(payload: unknown, now: number = Date.now(), unchanged?: unknown): void {
  const at = (payload as { publishAt?: unknown } | null | undefined)?.publishAt;
  if (at === undefined || at === null) return;
  if (typeof at !== "number" || !Number.isFinite(at)) {
    throw new Error("publishAt must be a timestamp in milliseconds");
  }
  if (at <= now && at !== unchanged) throw new Error("publishAt must be in the future");
}
