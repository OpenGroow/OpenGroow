// Shared types and date helpers of the Editorial Calendar page (ADR-086).

export type CalendarTarget = { target: string; label: string; service?: string; adapter?: string };

export type CalendarItem = {
  _id: string;
  planId: string;
  kind: string;
  title: string;
  brief: string;
  plannedAt: string;
  intent: "explore" | "exploit";
  rationale: string;
  publishTargets: string[];
  targets?: CalendarTarget[];
  creativeFamily?: { name: string } | null;
  plan: { periodStart: string; periodEnd: string } | null;
};

export type MonthKey = { year: number; month: number }; // month: 0-11

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
export const daysIn = ({ year, month }: MonthKey) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
export const shift = ({ year, month }: MonthKey, by: number): MonthKey => {
  const d = new Date(Date.UTC(year, month + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
};
export const monthLabel = ({ year, month }: MonthKey) => new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
export const formatLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
export const intentLabel = (intent: CalendarItem["intent"]) => (intent === "explore" ? "Explore" : "Exploit");
