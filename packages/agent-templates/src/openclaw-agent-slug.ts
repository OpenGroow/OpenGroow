/**
 * OpenClaw agent id derived from a Template id (issue #664).
 *
 * OpenClaw uses the agent id as a registry key and as a folder name, so it must
 * be a flat, lowercase `[a-z0-9_-]` token (max 64 chars) — a scoped Template id
 * such as `@opengroow/seo` cannot be used as is.
 *
 * - A clean unscoped id (`seo`, `social-engagement`) is returned unchanged:
 *   Agents registered before this derivation existed keep their OpenClaw id.
 * - A clean scoped id `@scope/name` becomes `scope--name`.
 * - Anything else (uppercase, dots, path separators, over-long, `--` inside a
 *   part...) is sanitized and suffixed with a hash of the original id, so the
 *   result stays safe, stable and distinct from every other id.
 *
 * Pure and dependency-free: it runs in the default Convex runtime (no node:*).
 */

const MAX_SLUG_LENGTH = 64;
const HASH_LENGTH = 8;
const CLEAN_PART = /^[a-z0-9][a-z0-9_-]*$/;
const SCOPED_ID = /^@([^/@]+)\/([^/@]+)$/;

/** FNV-1a (32-bit), hex, zero-padded: a stable disambiguator, not a security primitive. */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(HASH_LENGTH, "0");
}

const isCleanPart = (part: string): boolean => CLEAN_PART.test(part) && !part.includes("--");

export function openClawAgentSlug(templateId: string): string {
  if (templateId.trim() === "") throw new Error("Cannot derive an OpenClaw agent id from an empty Template id");

  const scoped = SCOPED_ID.exec(templateId);
  const clean = scoped
    ? isCleanPart(scoped[1]) && isCleanPart(scoped[2])
      ? `${scoped[1]}--${scoped[2]}`
      : undefined
    : isCleanPart(templateId)
      ? templateId
      : undefined;
  if (clean !== undefined && clean.length <= MAX_SLUG_LENGTH) return clean;

  const base =
    templateId
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG_LENGTH - HASH_LENGTH - 1)
      .replace(/-+$/g, "") || "agent";
  return `${base}-${shortHash(templateId)}`;
}
