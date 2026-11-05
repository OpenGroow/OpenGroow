// Which Publish targets a Mission goes to (ADR-069, docs/domain/publishing.md).
// A Publish target is the key of one channel entry of the Project's Publisher.
// Shared by the Convex functions and the review projection.

import type { QueryCtx } from "./_generated/server.js";

/** The Publish targets of a Mission or Schedule payload: `payload.publishTargets`,
 * chosen by the human among the Publisher's channels. Agents never choose them,
 * and there is no default. */
export function effectivePublishTargets(payload: unknown): string[] {
  const many = (payload as { publishTargets?: unknown } | null | undefined)?.publishTargets;
  if (!Array.isArray(many)) return [];
  return [...new Set(many.filter((t): t is string => typeof t === "string" && t !== ""))];
}

/** Names the keys of `targets` that are not (mapped) channels of the Publisher. */
export function unusableTargets(
  publisherTargets: ReadonlyArray<{ target: string; channelId?: string }> | undefined,
  targets: readonly string[],
): { unknown: string[]; unmapped: string[] } {
  const entries = publisherTargets ?? [];
  return {
    unknown: targets.filter((k) => !entries.some((t) => t.target === k)),
    unmapped: targets.filter((k) => entries.some((t) => t.target === k && !t.channelId)),
  };
}

/** Rejects a payload whose `publishTargets` name a channel that is not on the
 * Project's Publisher. Mutations have no Template registry, so this is the
 * only check they can make; mapping and the API key are checked at publish time. */
export async function assertKnownPublishTargets(ctx: QueryCtx, instanceId: string, payload: unknown): Promise<void> {
  const targets = effectivePublishTargets(payload);
  if (targets.length === 0) return;
  const publisher = await ctx.db
    .query("publishers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  const { unknown } = unusableTargets(publisher?.targets, targets);
  if (unknown.length > 0) {
    throw new Error(`Unknown channel ${unknown.map((t) => `"${t}"`).join(", ")}: it is not on the Project's Publisher`);
  }
}
