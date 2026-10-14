import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { scheduleUnitV } from "./validators.js";
import { computeNextRunAt, type Frequency } from "./schedules/frequency.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";

export const frequencyV = v.object({
  unit: scheduleUnitV,
  dayOfWeek: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
  hour: v.number(),
  minute: v.number(),
});

export const create = mutation({
  args: {
    instanceId: v.string(),
    templateId: v.string(),
    type: v.string(),
    payload: v.any(),
    frequency: frequencyV,
    timezone: v.string(),
    autoPublish: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = await ownerIdFor(ctx, args.instanceId);

    const frequency = args.frequency as Frequency;
    const now = Date.now();
    const nextRunAt = computeNextRunAt(frequency, args.timezone, now);

    const scheduleId = await ctx.db.insert("schedules", {
      ownerId,
      instanceId: args.instanceId,
      templateId: args.templateId,
      type: args.type,
      payload: args.payload,
      ...(args.autoPublish !== undefined ? { autoPublish: args.autoPublish } : {}),
      unit: frequency.unit,
      ...(frequency.dayOfWeek !== undefined ? { dayOfWeek: frequency.dayOfWeek } : {}),
      ...(frequency.dayOfMonth !== undefined ? { dayOfMonth: frequency.dayOfMonth } : {}),
      hour: frequency.hour,
      minute: frequency.minute,
      timezone: args.timezone,
      status: "active",
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    });

    return { scheduleId, nextRunAt };
  },
});

export const pause = mutation({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    await ctx.db.patch(args.scheduleId, { status: "paused", updatedAt: Date.now() });
  },
});

export const resume = mutation({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    const frequency: Frequency = {
      unit: schedule.unit,
      ...(schedule.dayOfWeek !== undefined ? { dayOfWeek: schedule.dayOfWeek } : {}),
      ...(schedule.dayOfMonth !== undefined ? { dayOfMonth: schedule.dayOfMonth } : {}),
      hour: schedule.hour,
      minute: schedule.minute,
    };
    const now = Date.now();
    const nextRunAt = computeNextRunAt(frequency, schedule.timezone, now);
    await ctx.db.patch(args.scheduleId, { status: "active", nextRunAt, updatedAt: now });
  },
});

export const updatePayload = mutation({
  args: { scheduleId: v.id("schedules"), payload: v.any() },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    await ctx.db.patch(args.scheduleId, { payload: args.payload, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    await ctx.db.delete(args.scheduleId);
  },
});

export const listByInstance = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await readOwnerId(ctx, args.instanceId);
    if (ownerId === null) return [];
    return await ctx.db
      .query("schedules")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .collect();
  },
});

// --- Schedule tick ---------------------------------------------------------
// A static cron (~1 min) scans this table; we do NOT register one Convex cron
// per user-defined Schedule (Convex crons are static/deploy-time).

export const listDueActive = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("schedules")
      .withIndex("by_status_nextRun", (q) =>
        q.eq("status", "active").lte("nextRunAt", args.now),
      )
      .collect();
  },
});

export const advanceNextRun = internalMutation({
  args: { scheduleId: v.id("schedules"), lastMissionId: v.optional(v.id("missions")) },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) return;

    const now = Date.now();
    const frequency: Frequency = {
      unit: schedule.unit,
      ...(schedule.dayOfWeek !== undefined ? { dayOfWeek: schedule.dayOfWeek } : {}),
      ...(schedule.dayOfMonth !== undefined ? { dayOfMonth: schedule.dayOfMonth } : {}),
      hour: schedule.hour,
      minute: schedule.minute,
    };
    const nextRunAt = computeNextRunAt(frequency, schedule.timezone, now);

    await ctx.db.patch(args.scheduleId, {
      nextRunAt,
      lastRunAt: now,
      lastError: undefined,
      ...(args.lastMissionId !== undefined ? { lastMissionId: args.lastMissionId } : {}),
      updatedAt: now,
    });
  },
});

export const recordError = internalMutation({
  args: { scheduleId: v.id("schedules"), error: v.string() },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) return;

    const now = Date.now();
    const frequency: Frequency = {
      unit: schedule.unit,
      ...(schedule.dayOfWeek !== undefined ? { dayOfWeek: schedule.dayOfWeek } : {}),
      ...(schedule.dayOfMonth !== undefined ? { dayOfMonth: schedule.dayOfMonth } : {}),
      hour: schedule.hour,
      minute: schedule.minute,
    };
    const nextRunAt = computeNextRunAt(frequency, schedule.timezone, now);

    await ctx.db.patch(args.scheduleId, {
      lastError: args.error,
      lastRunAt: now,
      nextRunAt,
      updatedAt: now,
    });
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.schedules.listDueActive, { now: Date.now() });
    for (const schedule of due) {
      try {
        const { missionId } = await ctx.runMutation(internal.missions.createForOwner, {
          ownerId: schedule.ownerId,
          instanceId: schedule.instanceId,
          templateId: schedule.templateId,
          type: schedule.type,
          payload: schedule.payload,
          ...(schedule.autoPublish !== undefined ? { autoPublish: schedule.autoPublish } : {}),
        });
        await ctx.runMutation(internal.schedules.advanceNextRun, {
          scheduleId: schedule._id,
          lastMissionId: missionId,
        });
      } catch (err) {
        await ctx.runMutation(internal.schedules.recordError, {
          scheduleId: schedule._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});
