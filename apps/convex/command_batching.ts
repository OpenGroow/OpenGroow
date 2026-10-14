import type { Doc } from "./_generated/dataModel.js";

/** Keep every coalescing transaction below Convex's read/write limits. */
export const MAX_COALESCE_BATCH = 25;

/**
 * Give sibling enqueue mutations a short window to land before the first
 * dispatch claims the queue. This is small relative to the network round-trip
 * it replaces, but makes a burst coalesce into one batch instead of 2+1.
 */
export const COMMAND_COALESCE_WINDOW_MS = 10;

/** Enqueue order, with `_creationTime` as the tie-break for same-millisecond inserts. */
export function byCreationOrder(a: Doc<"commands">, b: Doc<"commands">): number {
  return a.createdAt - b.createdAt || a._creationTime - b._creationTime;
}
