/**
 * Manifest validation for a Mission type's `publish` declaration (issue #16,
 * ADR-069). Pure function over raw manifest data.
 */

/** The closed set of Publishable kinds (V1). A new kind is a product change:
 * add it here and to the Publishable schema in `apps/convex/publishable.ts`
 * (a test pins both lists together). */
export const PUBLISHABLE_KINDS = ["video", "image", "carousel"] as const;
export type PublishableKind = (typeof PUBLISHABLE_KINDS)[number];

/** What a Mission type declares: the kind it produces and the logical Publish
 * targets it may be sent to (for example `instagram`, `pinterest:recipes`). */
export type PublishDeclaration = {
  kind: PublishableKind;
  targets: string[];
};

/** A Publish target is a short logical name: lowercase words joined by `-` or
 * `_`, with an optional `:qualifier` (never a service channel id). */
const TARGET_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*(?::[a-z0-9]+(?:[_-][a-z0-9]+)*)?$/;

export function isValidPublishTarget(raw: unknown): raw is string {
  return typeof raw === "string" && TARGET_PATTERN.test(raw);
}

/** Returns an actionable reason, or undefined when `publish` is absent or valid. */
export function publishDeclarationProblem(raw: unknown, at: string): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${at}.publish must be an object { kind, targets }`;
  }
  const publish = raw as Record<string, unknown>;
  for (const key of Object.keys(publish)) {
    if (key !== "kind" && key !== "targets") return `${at}.publish has unknown key "${key}"`;
  }
  if (!(PUBLISHABLE_KINDS as readonly unknown[]).includes(publish.kind)) {
    return `${at}.publish.kind ${JSON.stringify(publish.kind)} is not a known Publishable kind — one of ${PUBLISHABLE_KINDS.join(", ")}`;
  }
  const targets = publish.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return `${at}.publish.targets must be a non-empty array of Publish targets`;
  }
  for (const target of targets) {
    if (!isValidPublishTarget(target)) {
      return `${at}.publish.targets contains ${JSON.stringify(target)}, which is not a well-formed Publish target (lowercase letters, digits, "-" or "_", optionally ":qualifier", for example "pinterest:recipes")`;
    }
  }
  if (new Set(targets).size !== targets.length) {
    return `${at}.publish.targets contains duplicates`;
  }
  return undefined;
}
