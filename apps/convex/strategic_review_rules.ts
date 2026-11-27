// Pure rules of a Strategic Review result (ADR-085, issue #164): the size
// limits, the envelope shape and the memory comparison. No database access.

/** The size limits of a Strategic Review result, in one place. */
export const STRATEGIC_REVIEW_LIMITS = {
  /** Characters of the Performance Report. */
  reportChars: 40_000,
  /** Characters of the Strategic Memory. */
  memoryChars: 16_000,
  /** References of each type (recipes, Publications). */
  referencesPerType: 200,
} as const;

export const REFERENCE_KEYS = ["recipeIds", "publicationIds"] as const;
export type ReferenceKey = (typeof REFERENCE_KEYS)[number];

/** Raw (not yet checked against the database) reference ids, deduplicated. */
export type ReferenceIds = Record<ReferenceKey, string[]>;

export type ParsedEnvelope = { report: string; consolidatedMemory: string; references: ReferenceIds };

/** Validates the Agent's envelope; the reason is meant to be read by the user. */
export function parseEnvelope(raw: unknown): { ok: true; value: ParsedEnvelope } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "The result must be an object." };
  const input = raw as Record<string, unknown>;
  if (typeof input.report !== "string" || input.report.trim() === "") return { ok: false, message: "The report must be a non-empty string." };
  if (input.report.length > STRATEGIC_REVIEW_LIMITS.reportChars) {
    return { ok: false, message: `The report is over ${STRATEGIC_REVIEW_LIMITS.reportChars} characters.` };
  }
  if (typeof input.consolidatedMemory !== "string") return { ok: false, message: "The consolidated memory must be a string (empty allowed)." };
  if (input.consolidatedMemory.length > STRATEGIC_REVIEW_LIMITS.memoryChars) {
    return { ok: false, message: `The consolidated memory is over ${STRATEGIC_REVIEW_LIMITS.memoryChars} characters.` };
  }
  if (typeof input.references !== "object" || input.references === null || Array.isArray(input.references)) {
    return { ok: false, message: "The references must be an object." };
  }
  const given = input.references as Record<string, unknown>;
  const references = {} as ReferenceIds;
  for (const key of REFERENCE_KEYS) {
    const list = given[key] ?? [];
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) {
      return { ok: false, message: `references.${key} must be a list of ids.` };
    }
    if (list.length > STRATEGIC_REVIEW_LIMITS.referencesPerType) {
      return { ok: false, message: `references.${key} has more than ${STRATEGIC_REVIEW_LIMITS.referencesPerType} ids.` };
    }
    references[key] = [...new Set(list as string[])];
  }
  return { ok: true, value: { report: input.report, consolidatedMemory: input.consolidatedMemory, references } };
}

/** The text compared to decide `memoryChanged`: line endings unified, trailing whitespace dropped. */
export const normalizeMemory = (text: string): string => text.replace(/\r\n/g, "\n").trimEnd();
