/**
 * Manifest validation for a Mission type's `publish` declaration (issue #16,
 * ADR-069). Pure function over raw manifest data.
 */

/** The closed set of Publishable kinds (V1). A new kind is a product change:
 * add it here and to the Publishable schema in `apps/convex/publishable.ts`
 * (a test pins both lists together). */
export const PUBLISHABLE_KINDS = ["video", "image", "carousel"] as const;
export type PublishableKind = (typeof PUBLISHABLE_KINDS)[number];

/** What a Mission type declares: the kind it produces. Where it goes is chosen
 * per Mission or Schedule among the Publisher's channels (ADR-069). */
export type PublishDeclaration = {
  kind: PublishableKind;
};

/** The `publish` declaration of a Mission type, or undefined when it has none
 * (or the Mission type is unknown). */
export function publishDeclarationFor(
  manifest: { missionTypes?: ReadonlyArray<{ type: string; publish?: PublishDeclaration }> } | undefined,
  missionType: string,
): PublishDeclaration | undefined {
  return manifest?.missionTypes?.find((entry) => entry.type === missionType)?.publish;
}

/** Returns an actionable reason, or undefined when `publish` is absent or valid. */
export function publishDeclarationProblem(raw: unknown, at: string): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${at}.publish must be an object { kind }`;
  }
  const publish = raw as Record<string, unknown>;
  for (const key of Object.keys(publish)) {
    if (key !== "kind") return `${at}.publish has unknown key "${key}"`;
  }
  if (!(PUBLISHABLE_KINDS as readonly unknown[]).includes(publish.kind)) {
    return `${at}.publish.kind ${JSON.stringify(publish.kind)} is not a known Publishable kind — one of ${PUBLISHABLE_KINDS.join(", ")}`;
  }
  return undefined;
}
