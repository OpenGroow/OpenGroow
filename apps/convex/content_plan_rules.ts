import { isIsoDate } from "@opengroow/protocol/content-planning-pins";

// Pure rules of a Content Planning result (ADR-086, issue #176): the envelope shape, the size limits and the
// dates. No database access; what depends on the Project is checked where the plan is persisted.

/** The size limits of a Content Planning result, in one place. */
export const CONTENT_PLAN_LIMITS = {
  rationaleChars: 8_000,
  briefChars: 4_000,
  itemRationaleChars: 1_000,
  titleChars: 200,
  items: 100,
} as const;

export type PlannedItem = {
  missionType: string;
  recipeId: string;
  sourceId?: string;
  title: string;
  brief: string;
  plannedAt: string;
  intent: "explore" | "exploit";
  rationale: string;
};

export type ContentPlanEnvelope = { rationale: string; items: PlannedItem[] };

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);

/**
 * Validates the Agent's envelope against the pinned Planning period. The whole result is rejected, never filtered:
 * every faulty item is named by its position so the Agent can correct them all at once. Fields the Agent has no say
 * on (status, Project, period, Publish targets) are dropped, not read.
 */
export function parseContentPlanEnvelope(
  raw: unknown,
  period: { periodStart: string; periodEnd: string },
): { ok: true; value: ContentPlanEnvelope } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) return { ok: false, errors: ["The result must be an object."] };
  const errors: string[] = [];
  const L = CONTENT_PLAN_LIMITS;
  if (typeof raw.rationale !== "string" || raw.rationale.trim() === "") errors.push("The rationale must be a non-empty string.");
  else if (raw.rationale.length > L.rationaleChars) errors.push(`The rationale is over ${L.rationaleChars} characters.`);
  if (!Array.isArray(raw.items)) {
    errors.push("The items must be a list (empty allowed).");
    return { ok: false, errors };
  }
  if (raw.items.length > L.items) {
    errors.push(`The result has more than ${L.items} items.`);
    return { ok: false, errors };
  }
  const items: PlannedItem[] = [];
  raw.items.forEach((entry: unknown, index) => {
    const at = `items[${index}]`;
    const before = errors.length;
    if (!isRecord(entry)) {
      errors.push(`${at} must be an object.`);
      return;
    }
    const text = (key: string, max: number, required: boolean) => {
      const value = entry[key];
      if (typeof value !== "string" || (required && value.trim() === "")) errors.push(`${at}: ${key} must be a non-empty string.`);
      else if (value.length > max) errors.push(`${at}: ${key} is over ${max} characters.`);
    };
    text("missionType", 200, true);
    text("recipeId", 200, true);
    text("title", L.titleChars, true);
    text("brief", L.briefChars, true);
    text("rationale", L.itemRationaleChars, true);
    if (entry.sourceId !== undefined && (typeof entry.sourceId !== "string" || entry.sourceId === "")) errors.push(`${at}: sourceId must be a non-empty string when given.`);
    if (entry.intent !== "explore" && entry.intent !== "exploit") errors.push(`${at}: intent must be "explore" or "exploit".`);
    if (typeof entry.plannedAt !== "string" || !isIsoDate(entry.plannedAt)) errors.push(`${at}: plannedAt must be a date written YYYY-MM-DD.`);
    else if (entry.plannedAt < period.periodStart || entry.plannedAt > period.periodEnd) {
      errors.push(`${at}: plannedAt ${entry.plannedAt} is outside the Planning period ${period.periodStart} to ${period.periodEnd}.`);
    }
    if (errors.length === before) {
      items.push({
        missionType: entry.missionType as string,
        recipeId: entry.recipeId as string,
        ...(typeof entry.sourceId === "string" ? { sourceId: entry.sourceId } : {}),
        title: entry.title as string,
        brief: entry.brief as string,
        plannedAt: entry.plannedAt as string,
        intent: entry.intent as "explore" | "exploit",
        rationale: entry.rationale as string,
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { rationale: raw.rationale as string, items } };
}
