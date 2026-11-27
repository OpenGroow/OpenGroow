import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { provisionCurrentTemplate } from "./bundled_recipes.js";
import { scheduleUnitV } from "./validators.js";
import { computeNextRunAt, frequencyOf } from "./schedules/frequency.js";
import { ownerIdFor, readOwnerId } from "./instance_ownership.js";
import { createManualMission } from "./missions.js";
import { assertValidPublishAt } from "./publish_at.js";
import { assertScheduleRunnable, defaultRecipeOf, resolveScheduleRecipe } from "./schedule_recipes.js";
import { isCreativeMissionType } from "./mission_recipe.js";
import { assertKnownPublishTargets, assertPayloadChannelsSupportMissionType, assertPayloadSchedulable } from "./publication_targets.js";

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
    // Required for a creative Mission type (ADR-091): the form preselects the Default Recipe.
    recipeId: v.optional(v.id("productionRecipes")),
  },
  handler: async (ctx, args) => {
    assertValidPublishAt(args.payload);
    const ownerId = await ownerIdFor(ctx, args.instanceId);
    await assertKnownPublishTargets(ctx, args.instanceId, args.payload);
    await assertPayloadChannelsSupportMissionType(ctx, args);
    await assertPayloadSchedulable(ctx, args.instanceId, args.payload);

    const recipeId = await resolveScheduleRecipe(ctx, args);

    const frequency = frequencyOf(args.frequency);
    const now = Date.now();
    const nextRunAt = computeNextRunAt(frequency, args.timezone, now);

    const scheduleId = await ctx.db.insert("schedules", {
      ownerId,
      instanceId: args.instanceId,
      templateId: args.templateId,
      type: args.type,
      payload: args.payload,
      ...(recipeId ? { recipeId } : {}),
      ...(args.autoPublish !== undefined ? { autoPublish: args.autoPublish } : {}),
      ...frequency,
      timezone: args.timezone,
      status: "active",
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    });

    return { scheduleId, nextRunAt };
  },
});

// Default Schedules a Template declares (`missionTypes[].defaultSchedule`), created at
// activation. A Mission type that already has a Schedule for this Agent is left alone, so
// reactivating never duplicates one.
export const createDefaults = internalMutation({
  args: {
    ownerId: v.string(),
    instanceId: v.string(),
    templateId: v.string(),
    timezone: v.string(),
    defaults: v.array(v.object({ type: v.string(), payload: v.any(), frequency: frequencyV })),
  },
  handler: async (ctx, args) => {
    const { ownerId } = args;
    const existing = await ctx.db
      .query("schedules")
      .withIndex("by_instance_template", (q) => q.eq("instanceId", args.instanceId).eq("templateId", args.templateId))
      .collect();
    const now = Date.now();
    // Make sure the Default Recipes exist: a Default Schedule of a creative type records one explicitly.
    await provisionCurrentTemplate(ctx, args.instanceId, args.templateId);
    for (const entry of args.defaults) {
      if (existing.some((schedule) => schedule.type === entry.type)) continue;
      let recipeId: Id<"productionRecipes"> | undefined;
      if (await isCreativeMissionType(ctx, args.instanceId, args.templateId, entry.type)) {
        recipeId = (await defaultRecipeOf(ctx, args.instanceId, args.templateId, entry.type))?._id;
        // No Default Recipe to record: no creative Schedule is created without one.
        if (!recipeId) continue;
      }
      const frequency = frequencyOf(entry.frequency);
      await ctx.db.insert("schedules", {
        ownerId,
        instanceId: args.instanceId,
        templateId: args.templateId,
        type: entry.type,
        payload: entry.payload,
        ...(recipeId ? { recipeId } : {}),
        ...frequency,
        timezone: args.timezone,
        status: "active",
        nextRunAt: computeNextRunAt(frequency, args.timezone, now),
        createdAt: now,
        updatedAt: now,
      });
    }
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
    const frequency = frequencyOf(schedule);
    const now = Date.now();
    const nextRunAt = computeNextRunAt(frequency, schedule.timezone, now);
    await assertScheduleRunnable(ctx, schedule);
    // A Mission type that became operational needs no recipe: the stale reason goes with the resume.
    await ctx.db.patch(args.scheduleId, { status: "active", pausedReason: undefined, nextRunAt, updatedAt: now });
  },
});

// Sets the recipe of a Schedule: required to fix a Schedule paused as "recipe unavailable". The reason clears; the
// Schedule keeps its status, so the user resumes it when ready.
export const setRecipe = mutation({
  args: { scheduleId: v.id("schedules"), recipeId: v.id("productionRecipes") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    const recipeId = await resolveScheduleRecipe(ctx, { ...schedule, recipeId: args.recipeId });
    await ctx.db.patch(args.scheduleId, { recipeId, pausedReason: undefined, updatedAt: Date.now() });
  },
});

// Changes the cadence of a Schedule. The next run is recomputed from now; a paused Schedule stays paused.
export const updateFrequency = mutation({
  args: { scheduleId: v.id("schedules"), frequency: frequencyV },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    const frequency = frequencyOf(args.frequency);
    const now = Date.now();
    await ctx.db.patch(args.scheduleId, {
      unit: frequency.unit,
      dayOfWeek: frequency.unit === "weekly" ? frequency.dayOfWeek : undefined,
      dayOfMonth: frequency.unit === "monthly" ? frequency.dayOfMonth : undefined,
      hour: frequency.hour,
      minute: frequency.minute,
      nextRunAt: computeNextRunAt(frequency, schedule.timezone, now),
      updatedAt: now,
    });
  },
});

export const updatePayload = mutation({
  args: { scheduleId: v.id("schedules"), payload: v.any() },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    // A stale absolute publishAt the edit leaves untouched is kept (it publishes immediately at spawn).
    assertValidPublishAt(args.payload, Date.now(), (schedule.payload as { publishAt?: unknown } | null)?.publishAt);
    await assertKnownPublishTargets(ctx, schedule.instanceId, args.payload);
    await assertPayloadChannelsSupportMissionType(ctx, { ...args, instanceId: schedule.instanceId, templateId: schedule.templateId, type: schedule.type });
    await assertPayloadSchedulable(ctx, schedule.instanceId, args.payload);
    await ctx.db.patch(args.scheduleId, { payload: args.payload, updatedAt: Date.now() });
  },
});

// Toggles the `autoPublish` default of an existing Schedule. It only affects the
// Missions created from now on (the tick copies it onto each new Mission); Missions
// already spawned keep their own value. Allowed whatever the Schedule's status,
// so a paused Schedule can be fixed before it is resumed.
export const setAutoPublish = mutation({
  args: { scheduleId: v.id("schedules"), autoPublish: v.boolean() },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    await ctx.db.patch(args.scheduleId, { autoPublish: args.autoPublish, updatedAt: Date.now() });
  },
});

// "Run now": a Mission from the Schedule's own type, payload and recipe, through the same validation as the tick and
// the Composer. The recipe is read here, never taken from the client.
export const runNow = mutation({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Forbidden");
    const ownerId = await ownerIdFor(ctx, schedule.instanceId);
    if (schedule.ownerId !== ownerId) throw new Error("Forbidden");
    return await createManualMission(
      ctx,
      ownerId,
      { instanceId: schedule.instanceId, templateId: schedule.templateId, type: schedule.type, payload: schedule.payload },
      schedule.recipeId ? { recipeId: schedule.recipeId } : undefined,
    );
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
    const frequency = frequencyOf(schedule);
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
    const frequency = frequencyOf(schedule);
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
        if (await ctx.runQuery(internal.schedule_outdated.isNewRunBlocked, { instanceId: schedule.instanceId, templateId: schedule.templateId })) {
          await ctx.runMutation(internal.schedule_outdated.skipOccurrence, { scheduleId: schedule._id });
          continue;
        }
        const { missionId } = await ctx.runMutation(internal.missions.createForOwner, {
          ownerId: schedule.ownerId,
          instanceId: schedule.instanceId,
          templateId: schedule.templateId,
          type: schedule.type,
          payload: schedule.payload,
          // The same validation as the Composer: a creative Mission type without a compatible recipe is refused.
          ...(schedule.recipeId ? { recipe: { recipeId: schedule.recipeId } } : {}),
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
