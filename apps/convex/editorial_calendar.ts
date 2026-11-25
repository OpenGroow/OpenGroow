import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";

// The Editorial Calendar read (ADR-086, issue #182): the approved Planned Contents of every Content Plan of a Project
// within a date range. Owner-scoped and read-only. Nothing is stored for the calendar: it is the contents by date.

const MAX_CONTENTS = 500;

export const range = query({
  args: { instanceId: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const rows = await ctx.db
      .query("plannedContents")
      .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", args.instanceId).eq("status", "approved").gte("plannedAt", args.from).lte("plannedAt", args.to))
      .take(MAX_CONTENTS);
    const plans = new Map<string, { periodStart: string; periodEnd: string } | null>();
    for (const row of rows) {
      if (plans.has(row.planId)) continue;
      const plan = await ctx.db.get(row.planId);
      plans.set(row.planId, plan && plan.instanceId === args.instanceId ? { periodStart: plan.periodStart, periodEnd: plan.periodEnd } : null);
    }
    return rows.map((row) => {
      const { _id, planId, kind, title, brief, plannedAt, intent, rationale, publishTargets } = row;
      return { _id, planId, kind, title, brief, plannedAt, intent, rationale, publishTargets, plan: plans.get(planId) ?? null };
    });
  },
});
