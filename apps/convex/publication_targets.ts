// Which Publish targets a Mission goes to (ADR-069, docs/domain/publishing.md).
// Pure, shared by the Convex functions and the review projection.

/** The Publish target of a Mission: the one the human chose in the review, else
 * the first target its Mission type declares. Agents never choose it. */
export function effectivePublishTarget(payload: unknown, declaredTargets: readonly string[]): string | undefined {
  const chosen = (payload as { publishTarget?: unknown } | null | undefined)?.publishTarget;
  return typeof chosen === "string" && chosen !== "" ? chosen : declaredTargets[0];
}

/** All Publish targets of a Mission: `payload.publishTargets` when the human
 * chose several in the review, else the single target (see above). */
export function effectivePublishTargets(payload: unknown, declaredTargets: readonly string[]): string[] {
  const many = (payload as { publishTargets?: unknown } | null | undefined)?.publishTargets;
  if (Array.isArray(many)) {
    const targets = [...new Set(many.filter((t): t is string => typeof t === "string" && t !== ""))];
    if (targets.length > 0) return targets;
  }
  const single = effectivePublishTarget(payload, declaredTargets);
  return single ? [single] : [];
}
