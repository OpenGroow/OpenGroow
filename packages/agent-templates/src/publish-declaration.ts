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

/** The media fields of each kind, the only ones `publish.media` may map. */
export const MEDIA_PUBLISHABLE_FIELDS = {
  video: ["videoUrl", "coverUrl"],
  image: ["imageUrl"],
  carousel: ["slideUrls"],
} as const satisfies Record<PublishableKind, readonly string[]>;

// A path in the MCP tool output: dot-separated keys, each optionally followed
// by `[n]` or `[*]` (every item of an array).
const MEDIA_PATH_SEGMENT = /^[A-Za-z_][\w-]*(\[(\*|\d+)\])*$/;

/** What a Mission type declares: the kind it produces. Where it goes is chosen
 * per Mission or Schedule among the Publisher's channels (ADR-069).
 * `require` lists optional fields of the kind that the Template guarantees: it
 * can only tighten the Publishable, never loosen it. */
export type PublishDeclaration = {
  kind: PublishableKind;
  require?: string[];
  /**
   * Intended contract (ADR-069 amendment): map from a media field to the path
   * of its value in the MCP tool output, so URLs and slide order come from the
   * MCP and the Agent only writes text. Validated here; NOT applied yet (no
   * place where OpenGroow reads the tool output of a synchronous Run).
   */
  media?: Record<string, string>;
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
    return `${at}.publish must be an object { kind, require?, media? }`;
  }
  const publish = raw as Record<string, unknown>;
  for (const key of Object.keys(publish)) {
    if (key !== "kind" && key !== "require" && key !== "media") return `${at}.publish has unknown key "${key}"`;
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
  if (publish.media !== undefined) {
    if (!publish.media || typeof publish.media !== "object" || Array.isArray(publish.media)) {
      return `${at}.publish.media must be an object mapping a media field to a path`;
    }
    const allowed: readonly string[] = MEDIA_PUBLISHABLE_FIELDS[publish.kind as PublishableKind];
    for (const [field, path] of Object.entries(publish.media as Record<string, unknown>)) {
      if (!allowed.includes(field)) {
        return `${at}.publish.media "${field}" is not a media field of kind "${String(publish.kind)}" — one of ${allowed.join(", ")}`;
      }
      const segments = typeof path === "string" ? path.split(".") : [];
      if (!segments.length || !segments.every((segment) => MEDIA_PATH_SEGMENT.test(segment))) {
        return `${at}.publish.media.${field} is not a valid path (dot-separated keys, optional [n] or [*]): ${JSON.stringify(path)}`;
      }
      if (field !== "slideUrls" && String(path).includes("[*]")) {
        return `${at}.publish.media.${field} cannot use [*]: only slideUrls takes a list`;
      }
    }
  }
  return undefined;
}
