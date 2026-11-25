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
    const plans = new Map<string, { periodStart: string; periodEnd: string } | null>();
    for (const row of rows) {
      if (plans.has(row.planId)) continue;
      const plan = await ctx.db.get(row.planId);
      plans.set(row.planId, plan && plan.instanceId === args.instanceId ? { periodStart: plan.periodStart, periodEnd: plan.periodEnd } : null);
    }
    const publishers = await projectPublishers(ctx, args.instanceId);
    const families = new Map<string, { name: string } | null>();
    for (const row of rows) {
      if (families.has(row.recipeId)) continue;
      const recipe = await ctx.db.get(row.recipeId);
      const family = recipe && recipe.instanceId === args.instanceId ? await ctx.db.get(recipe.creativeFamilyId) : null;
      families.set(row.recipeId, family && family.instanceId === args.instanceId ? { name: family.name } : null);
    }
    const items = rows.map((row) => {
      const { _id, planId, kind, title, brief, plannedAt, intent, rationale, publishTargets } = row;
      // `targets`: each publish target resolved for display (same label rule as the Content Plans page).
      const targets = publishTargets.map((target) => {
        const found = channelOf(publishers, target);
        return found ? { target, label: channelLabel(found.channel), service: found.channel.channelService, adapter: found.publisher.adapter } : { target, label: target };
      });
      return { _id, planId, kind, title, brief, plannedAt, intent, rationale, publishTargets, targets, creativeFamily: families.get(row.recipeId) ?? null, plan: plans.get(planId) ?? null };
    });
    // `truncated`: the range holds more contents than are returned, so the calendar must say it shows only part of it.
    return { items, truncated };
  },
});
