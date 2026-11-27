import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { channelLabel } from "./content_plan_review.js";
import { readOwnerId } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";

// The Editorial Calendar read (ADR-086, issue #182): the approved Planned Contents of every Content Plan of a Project
// within a date range. Owner-scoped and read-only. Nothing is stored for the calendar: it is the contents by date.

const MAX_CONTENTS = 500;

export const range = query({
  args: { instanceId: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return { items: [], truncated: false };
    const found = await ctx.db
      .query("plannedContents")
      .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", args.instanceId).eq("status", "approved").gte("plannedAt", args.from).lte("plannedAt", args.to))
      .take(MAX_CONTENTS + 1);
    const truncated = found.length > MAX_CONTENTS;
    const rows = found.slice(0, MAX_CONTENTS);
    const planIds = [...new Set(rows.map((row) => row.planId))];
    const [planDocs, publishers] = await Promise.all([
      Promise.all(planIds.map((id) => ctx.db.get(id))),
      projectPublishers(ctx, args.instanceId),
    ]);
    const plans = new Map(planIds.map((id, i) => {
      const plan = planDocs[i];
      return [id, plan && plan.instanceId === args.instanceId ? { periodStart: plan.periodStart, periodEnd: plan.periodEnd } : null] as const;
    }));
    const items = rows.map((row) => {
      const { _id, planId, title, brief, plannedAt, intent, rationale, publishTargets } = row;
      // `targets`: each publish target resolved for display (same label rule as the Content Plans page).
      const targets = publishTargets.map((target) => {
        const found = channelOf(publishers, target);
        return found ? { target, label: channelLabel(found.channel), service: found.channel.channelService, adapter: found.publisher.adapter } : { target, label: target };
      });
      return { _id, planId, contentType: row.contentType, title, brief, plannedAt, intent, rationale, publishTargets, targets, plan: plans.get(planId) ?? null };
    });
    // `truncated`: the range holds more contents than are returned, so the calendar must say it shows only part of it.
    return { items, truncated };
  },
});
