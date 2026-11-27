import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import { computeNextRunAt, frequencyOf } from "./schedules/frequency.js";
import { newRunBlock } from "./template_runnable.js";

// The Template of a Schedule is outdated (ADR-091): its occurrence passes without a Mission and without an error, and
// the Schedule keeps its status. Only the next occurrence moves, so it resumes by itself once the Template is updated.
export const skipOccurrence = internalMutation({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) return;
    await ctx.db.patch(args.scheduleId, { nextRunAt: computeNextRunAt(frequencyOf(schedule), schedule.timezone, Date.now()) });
  },
});

/** Whether a new Run cannot start from the Template of a Schedule (its installed version is outdated). */
export const isNewRunBlocked = internalQuery({
  args: { instanceId: v.string(), templateId: v.string() },
  handler: async (ctx, args) => (await newRunBlock(ctx, args.instanceId, args.templateId)) !== null,
});
