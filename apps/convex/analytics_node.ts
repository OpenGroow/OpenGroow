"use node";

import { v, type Infer } from "convex/values";
import { pickDeclaredMetrics, pickMetrics } from "@opengroow/publisher-sdk";
import { internal } from "./_generated/api.js";
import { action, internalAction, type ActionCtx } from "./_generated/server.js";
import { loadAnalyticsAdapter } from "./analytics/load_node.js";
import { messageOf } from "./error_message.js";
import { RETRY_AFTER_MS, type outcomeV } from "./analytics.js";

type Item = Awaited<ReturnType<typeof readingsDue>>[number];
const readingsDue = (ctx: ActionCtx, now: number) => ctx.runQuery(internal.analytics.due, { now });

/** One reading, as the outcome to record: never throws (a failing service is an outcome). */
async function readOne(ctx: ActionCtx, item: Item, now: number): Promise<Infer<typeof outcomeV>> {
  try {
    const adapter = item.analyticsAdapter ? await loadAnalyticsAdapter(ctx, item.analyticsAdapter) : null;
    if (!adapter) return { kind: "unmeasured", reason: "No Analytics Adapter is linked to this channel" };
    // The later of the Template's delay and the adapter's earliest delay wins.
    const readyAt = item.publishedAt + Math.max(item.delayMs, adapter.earliestDelayMs);
    if (now < readyAt) return { kind: "postponed", nextAt: readyAt };
    // No reading is tried before the Publication has the key the adapter needs.
    const key = adapter.needs === "externalId" ? item.externalId : item.externalUrl;
    if (!key) return { kind: "postponed", nextAt: now + RETRY_AFTER_MS };
    // The owner can fix this one: say so rather than reading "no data yet".
    if (!item.connection) {
      return { kind: "failed", error: `The Project has no connection to the Analytics Adapter "${item.analyticsAdapter}": add its URL and API key` };
    }
    const result = await adapter.read(item.connection, { [adapter.needs]: key, kind: item.kind, publishedAt: item.publishedAt });
    if (!result.ok) return { kind: "failed", error: result.error };
    if (result.reading.status === "unavailable") return { kind: "post_unknown", reason: result.reading.reason };
    if (result.reading.status === "no_data") return { kind: "no_data" };
    const metrics = item.declaredMetrics ? pickDeclaredMetrics(item.declaredMetrics, result.reading.metrics) : pickMetrics(item.kind, result.reading.metrics);
    return Object.keys(metrics).length > 0 ? { kind: "taken", metrics, adapter: item.analyticsAdapter ?? undefined } : { kind: "no_data" };
  } catch (error) {
    return { kind: "failed", error: messageOf(error) };
  }
}

/** Readings run this many at a time: one slow service does not hold the others back, none floods a service. */
const READ_CONCURRENCY = 8;

/** Every item read, in bounded parallel batches, in order. */
async function readAll(ctx: ActionCtx, items: Item[], now: number): Promise<Array<Infer<typeof outcomeV>>> {
  const outcomes: Array<Infer<typeof outcomeV>> = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    outcomes.push(...(await Promise.all(items.slice(i, i + READ_CONCURRENCY).map((item) => readOne(ctx, item, now)))));
  }
  return outcomes;
}

/**
 * Takes the readings that are due (ADR-078). Polling, like Publications: a
 * failing reading is recorded and retried, never raised, and never changes
 * the Publication.
 */
export const collectDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await readingsDue(ctx, now);
    const read = await readAll(ctx, due, now);
    const outcomes = due.map((item, i) => ({ id: item.id, outcome: read[i] }));
    if (outcomes.length > 0) await ctx.runMutation(internal.analytics.recordMany, { outcomes });
  },
});

/**
 * "Refresh" on the Analytics page: reads every measured post of the Project now, outside the schedule.
 * What it reads is added as a Snapshot; the schedule is not advanced, and what it cannot read is
 * reported, not recorded (the next scheduled reading tries again).
 */
export const refresh = action({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<{ read: number; unavailable: number; failed: number; error?: string }> => {
    // Posts published before they were measured join the Analytics page with this first reading.
    await ctx.runMutation(internal.analytics.backfill, { instanceId: args.instanceId });
    const items = await ctx.runQuery(internal.analytics.forRefresh, { instanceId: args.instanceId });
    const now = Date.now();
    const readings: Array<{ id: Item["id"]; metrics: Record<string, number>; adapter?: string }> = [];
    let unavailable = 0;
    let failed = 0;
    let error: string | undefined;
    const outcomes = await readAll(ctx, items, now);
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.kind === "taken") readings.push({ id: items[i].id, metrics: outcome.metrics, adapter: outcome.adapter });
      else if (outcome.kind === "failed") {
        failed += 1;
        error ??= outcome.error;
      } else unavailable += 1;
    }
    if (readings.length > 0) await ctx.runMutation(internal.analytics.recordRefreshed, { readings });
    return { read: readings.length, unavailable, failed, ...(error ? { error } : {}) };
  },
});
