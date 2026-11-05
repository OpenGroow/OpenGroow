// Which Publish targets a Mission goes to (ADR-069, docs/domain/publishing.md).
// A Publish target is the key of one channel entry of the Project's Publisher.
// Pure, shared by the Convex functions and the review projection.

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
