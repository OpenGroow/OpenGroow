/**
 * Manifest validation for a Mission type's `publish` declaration (issue #16,
 * ADR-069). Pure function over raw manifest data.
 */

/** The closed set of Publishable kinds (V1). A new kind is a product change:
 * add it here and to the Publishable schema in `apps/convex/publishable.ts`
 * (a test pins both lists together). */
export const PUBLISHABLE_KINDS = ["video", "image", "carousel"] as const;
export type PublishableKind = (typeof PUBLISHABLE_KINDS)[number];

/** The optional fields of each kind that a Template may guarantee through
 * `publish.require` (a test pins this against the Publishable zod schema in
 * `apps/convex/publishable.ts`). `metadata` is free-form and cannot be required. */
export const OPTIONAL_PUBLISHABLE_FIELDS = {
  video: ["coverUrl", "title", "link", "tags"],
  image: ["link", "altText"],
  carousel: ["link", "altText"],
} as const satisfies Record<PublishableKind, readonly string[]>;

/** What a Mission type declares: the kind it produces. Where it goes is chosen
 * per Mission or Schedule among the Publisher's channels (ADR-069).
 * `require` lists optional fields of the kind that the Template guarantees: it
 * can only tighten the Publishable, never loosen it. */
export type PublishDeclaration = {
  kind: PublishableKind;
  require?: string[];
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
    return `${at}.publish must be an object { kind, require? }`;
  }
  const publish = raw as Record<string, unknown>;
  for (const key of Object.keys(publish)) {
    if (key !== "kind" && key !== "require") return `${at}.publish has unknown key "${key}"`;
  }
  if (!(PUBLISHABLE_KINDS as readonly unknown[]).includes(publish.kind)) {
    return `${at}.publish.kind ${JSON.stringify(publish.kind)} is not a known Publishable kind — one of ${PUBLISHABLE_KINDS.join(", ")}`;
  }
  if (publish.require !== undefined) {
    if (!Array.isArray(publish.require)) return `${at}.publish.require must be an array of field names`;
    const optional: readonly string[] = OPTIONAL_PUBLISHABLE_FIELDS[publish.kind as PublishableKind];
    const seen = new Set<unknown>();
    for (const field of publish.require) {
      if (seen.has(field)) return `${at}.publish.require lists ${JSON.stringify(field)} twice`;
      seen.add(field);
      if (typeof field !== "string" || !optional.includes(field)) {
        return `${at}.publish.require ${JSON.stringify(field)} is not an optional field of kind "${String(publish.kind)}" — one of ${optional.join(", ")} (required fields are always required)`;
      }
    }
  }
  return undefined;
}
