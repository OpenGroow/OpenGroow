// The analysis period of a `strategic_review` Job (ADR-085): shared by the
// Convex mutation that stores it and the dashboard form that edits it.

export const DEFAULT_ANALYSIS_DAYS = 30;
export const MIN_ANALYSIS_DAYS = 1;
export const MAX_ANALYSIS_DAYS = 365;

export function isValidAnalysisDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_ANALYSIS_DAYS && value <= MAX_ANALYSIS_DAYS;
}

/** The `analysisDays` of a Job config; the default when it holds none or an invalid one. */
export function analysisDaysOf(config: unknown): number {
  const value = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>).analysisDays : undefined;
  return isValidAnalysisDays(value) ? value : DEFAULT_ANALYSIS_DAYS;
}
