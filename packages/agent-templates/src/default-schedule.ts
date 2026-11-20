/**
 * Manifest validation for a Mission type's `defaultSchedule` (ADR-081): the cadence of the
 * Schedule OpenGroow creates when the Agent is first activated. The user can change it
 * afterwards. The timezone is the user's, never declared by a Template.
 */
export type DefaultScheduleDeclaration = {
  unit: "daily" | "weekly" | "monthly";
  /** 0-6, weekly. */
  dayOfWeek?: number;
  /** 1-31, monthly. */
  dayOfMonth?: number;
  hour: number;
  minute: number;
};

const KEYS = new Set(["unit", "dayOfWeek", "dayOfMonth", "hour", "minute"]);

const isInt = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** An actionable reason, or undefined when `defaultSchedule` is absent or valid. */
export function defaultScheduleProblem(raw: unknown, at: string): string | undefined {
  if (raw === undefined) return undefined;
  const where = `${at}.defaultSchedule`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${where} must be a mapping`;
  const entry = raw as Record<string, unknown>;
  const unknown = Object.keys(entry).find((key) => !KEYS.has(key));
  if (unknown) return `${where} has an unknown key ${JSON.stringify(unknown)} (allowed: ${[...KEYS].join(", ")})`;
  if (entry.unit !== "daily" && entry.unit !== "weekly" && entry.unit !== "monthly") {
    return `${where}.unit must be "daily", "weekly" or "monthly"`;
  }
  if (!isInt(entry.hour, 0, 23)) return `${where}.hour must be an integer from 0 to 23`;
  if (!isInt(entry.minute, 0, 59)) return `${where}.minute must be an integer from 0 to 59`;
  if (entry.unit === "weekly" && !isInt(entry.dayOfWeek, 0, 6)) return `${where}.dayOfWeek (0-6) is required for a weekly cadence`;
  if (entry.unit === "monthly" && !isInt(entry.dayOfMonth, 1, 31)) return `${where}.dayOfMonth (1-31) is required for a monthly cadence`;
  if (entry.unit !== "weekly" && entry.dayOfWeek !== undefined) return `${where}.dayOfWeek only applies to a weekly cadence`;
  if (entry.unit !== "monthly" && entry.dayOfMonth !== undefined) return `${where}.dayOfMonth only applies to a monthly cadence`;
  return undefined;
}
