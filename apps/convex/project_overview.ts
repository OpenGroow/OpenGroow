import { v } from "convex/values";
import { query } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { readOwnerId } from "./instance_ownership.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSION_STATUSES = [
  "todo",
  "doing",
  "blocked",
  "to_validate",
  "approved",
  "done",
  "failed",
  "cancelled",
] as const;
// Per-status cap of the scan below: a Project with more Missions than this in
// two periods gets `truncated`, and the dashboard shows the figures as "N+".
const SCAN_CAP = 1000;
const RUN_SCAN_CAP = 500;
const TOP_AGENTS = 5;
const RECENT_ACTIVITY = 6;

/** How the Mission statuses fold into the Overview's five groups. */
export type OverviewGroup = "done" | "progress" | "review" | "failed" | "stopped";

export function overviewGroup(status: Doc<"missions">["status"]): OverviewGroup {
  switch (status) {
    case "done":
      return "done";
    case "todo":
    case "doing":
      return "progress";
    case "to_validate":
    case "approved":
    case "blocked":
      return "review";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
  }
}

type GroupCounts = Record<OverviewGroup, number>;

function emptyCounts(): GroupCounts {
  return { done: 0, progress: 0, review: 0, failed: 0, stopped: 0 };
}

type MissionRow = Pick<
  Doc<"missions">,
  "_id" | "templateId" | "status" | "createdAt" | "updatedAt" | "type" | "name" | "summary" | "number"
>;
type RunRow = Pick<Doc<"runs">, "templateId" | "dispatchedAt" | "completedAt">;

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The Overview figures of a Project over one period and the one before it.
 * Missions are a cohort by creation date (the donut and the daily chart
 * describe the same Missions); run times come from Runs completed in the
 * period. Pure, so it is tested without a database.
 */
export function buildProjectOverview(args: {
  missions: MissionRow[];
  runs: RunRow[];
  days: number;
  until: number;
  tzOffsetMinutes: number;
}) {
  const { missions, runs, days, until, tzOffsetMinutes } = args;
  const since = until - days * DAY_MS;
  const previousSince = since - days * DAY_MS;

  // Day buckets are cut at the viewer's local midnight: shift into local time,
  // floor, shift back.
  const offsetMs = tzOffsetMinutes * 60_000;
  const dayStart = (t: number) => Math.floor((t - offsetMs) / DAY_MS) * DAY_MS + offsetMs;
  const firstDay = dayStart(since);
  const bucketCount = Math.floor((dayStart(until - 1) - firstDay) / DAY_MS) + 1;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    start: firstDay + i * DAY_MS,
    total: 0,
    ...emptyCounts(),
  }));
  const runDurations: number[][] = buckets.map(() => []);

  const counts = emptyCounts();
  let total = 0;
  let previousTotal = 0;
  let previousDone = 0;
  const perAgent = new Map<string, { counts: GroupCounts; total: number; durations: number[] }>();
  const agent = (templateId: string) => {
    let entry = perAgent.get(templateId);
    if (!entry) {
      entry = { counts: emptyCounts(), total: 0, durations: [] };
      perAgent.set(templateId, entry);
    }
    return entry;
  };

  for (const mission of missions) {
    const group = overviewGroup(mission.status);
    if (mission.createdAt >= since && mission.createdAt < until) {
      total += 1;
      counts[group] += 1;
      const bucket = buckets[Math.floor((dayStart(mission.createdAt) - firstDay) / DAY_MS)];
      if (bucket) {
        bucket.total += 1;
        bucket[group] += 1;
      }
      const entry = agent(mission.templateId);
      entry.total += 1;
      entry.counts[group] += 1;
    } else if (mission.createdAt >= previousSince && mission.createdAt < since) {
      previousTotal += 1;
      if (group === "done") previousDone += 1;
    }
  }

  const durations: number[] = [];
  const previousDurations: number[] = [];
  for (const run of runs) {
    if (run.completedAt === undefined || run.dispatchedAt === undefined) continue;
    const duration = run.completedAt - run.dispatchedAt;
    if (duration <= 0) continue;
    if (run.completedAt >= since && run.completedAt < until) {
      durations.push(duration);
      agent(run.templateId).durations.push(duration);
      const index = Math.floor((dayStart(run.completedAt) - firstDay) / DAY_MS);
      runDurations[index]?.push(duration);
    } else if (run.completedAt >= previousSince && run.completedAt < since) {
      previousDurations.push(duration);
    }
  }

  const agents = [...perAgent.entries()]
    .filter(([, entry]) => entry.total > 0)
    .map(([templateId, entry]) => {
      const settled = entry.counts.done + entry.counts.failed;
      return {
        templateId,
        missions: entry.total,
        // Share of settled Missions that succeeded; null until one has settled.
        successRate: settled === 0 ? null : entry.counts.done / settled,
        avgRunMs: average(entry.durations),
      };
    })
    .sort((a, b) => b.missions - a.missions || a.templateId.localeCompare(b.templateId))
    .slice(0, TOP_AGENTS);

  const recent = [...missions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_ACTIVITY)
    .map((m) => ({
      _id: m._id,
      number: m.number,
      name: m.name,
      summary: m.summary,
      type: m.type,
      templateId: m.templateId,
      status: m.status,
      updatedAt: m.updatedAt,
    }));

  return {
    since,
    until,
    buckets: buckets.map((bucket, i) => ({ ...bucket, avgRunMs: average(runDurations[i]) })),
    total,
    counts,
    previous: { total: previousTotal, done: previousDone, avgRunMs: average(previousDurations) },
    avgRunMs: average(durations),
    agents,
    recent,
  };
}

// The Project Overview page: Mission volume, status mix, run time, top Agents
// and recent activity over the last 7, 30 or 90 days. `until` comes from the
// client (rounded to the hour) so the query stays deterministic and cacheable.
export const projectOverview = query({
  args: {
    instanceId: v.string(),
    days: v.union(v.literal(7), v.literal(30), v.literal(90)),
    until: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return null;
    const previousSince = args.until - 2 * args.days * DAY_MS;

    // A Mission created in the two periods was updated after `previousSince`.
    const perStatus = await Promise.all(
      MISSION_STATUSES.map((status) =>
        ctx.db
          .query("missions")
          .withIndex("by_instance_status_updated", (q) =>
            q.eq("instanceId", args.instanceId).eq("status", status).gte("updatedAt", previousSince),
          )
          .filter((q) => q.eq(q.field("ownerId"), ownerId))
          .order("desc")
          .take(SCAN_CAP),
      ),
    );
    const truncated = perStatus.some((rows) => rows.length === SCAN_CAP);
    const missions = perStatus.flat();

    const templateIds = [...new Set(missions.map((m) => m.templateId))];
    const runLists = await Promise.all(
      templateIds.map((templateId) =>
        ctx.db
          .query("runs")
          .withIndex("by_instance_template_status_completed", (q) =>
            q
              .eq("instanceId", args.instanceId)
              .eq("templateId", templateId)
              .eq("status", "completed")
              .gte("completedAt", previousSince),
          )
          .filter((q) => q.neq(q.field("missionId"), undefined))
          .order("desc")
          .take(RUN_SCAN_CAP),
      ),
    );

    return {
      days: args.days,
      truncated,
      ...buildProjectOverview({
        missions,
        runs: runLists.flat(),
        days: args.days,
        until: args.until,
        tzOffsetMinutes: args.tzOffsetMinutes,
      }),
    };
  },
});
