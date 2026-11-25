// Views of the Content Plan review queries (ADR-086), shared by the Content Plans page components.

export type PublishTargetView = { target: string; uncertain: boolean; unavailable?: boolean; unsupported?: boolean; reason?: string };

export type PlannedContentView = {
  _id: string;
  kind: string;
  missionType: string;
  title: string;
  brief: string;
  plannedAt: string;
  intent: "explore" | "exploit";
  rationale: string;
  status: string;
  publishTargets: PublishTargetView[];
  recipe: { id: string; name: string } | null;
  creativeFamily: { id: string; name: string } | null;
  source: { id: string; label: string } | null;
};

export type DraftPlanView = {
  _id: string;
  periodStart: string;
  periodEnd: string;
  rationale: string;
  status: "draft";
  createdAt: number;
  contents: PlannedContentView[];
  quantities: Array<{ kind: string; count: number }>;
  distribution: { explore: number; exploit: number };
};

export type PlanHistoryView = {
  _id: string;
  periodStart: string;
  periodEnd: string;
  rationale: string;
  status: "approved" | "rejected";
  createdAt: number;
  counts: { total: number; approved: number; rejected: number };
};

export const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
export const periodLabel = (plan: { periodStart: string; periodEnd: string }) => `${formatDay(plan.periodStart)} to ${formatDay(plan.periodEnd)}`;
