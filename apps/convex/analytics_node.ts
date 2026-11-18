"use node";

import type { Infer } from "convex/values";
import { pickMetrics } from "@opengroow/publisher-sdk";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import { loadAnalyticsAdapter } from "./analytics/load_node.js";
import { messageOf } from "./error_message.js";
import { RETRY_AFTER_MS, type outcomeV } from "./analytics.js";

/**
 * Takes the readings that are due (ADR-078). Polling, like Publications: a
 * failing reading is recorded and retried, never raised, and never changes
 * the Publication.
 */
export const collectDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.analytics.due, { now });
    const outcomes: Array<{ id: (typeof due)[number]["id"]; outcome: Infer<typeof outcomeV> }> = [];
    for (const item of due) {
      const settle = async (outcome: Infer<typeof outcomeV>) => {
        outcomes.push({ id: item.id, outcome });
      };
      try {
        const adapter = item.analyticsAdapter ? await loadAnalyticsAdapter(ctx, item.analyticsAdapter) : null;
        if (!adapter) {
          await settle({ kind: "unmeasured", reason: "No Analytics Adapter is linked to this channel" });
          continue;
        }
        // The later of the Template's delay and the adapter's earliest delay wins.
        const readyAt = item.publishedAt + Math.max(item.delayMs, adapter.earliestDelayMs);
        if (now < readyAt) {
          await settle({ kind: "postponed", nextAt: readyAt });
          continue;
        }
        // No reading is tried before the Publication has the key the adapter needs.
        const key = adapter.needs === "externalId" ? item.externalId : item.externalUrl;
        if (!key) {
          await settle({ kind: "postponed", nextAt: now + RETRY_AFTER_MS });
          continue;
        }
        // The owner can fix this one: say so rather than reading "no data yet".
        if (!item.connection) {
          await settle({ kind: "failed", error: `The Project has no connection to the Analytics Adapter "${item.analyticsAdapter}": add its URL and API key` });
          continue;
        }
        const result = await adapter.read(item.connection, {
          [adapter.needs]: key,
          kind: item.kind,
          publishedAt: item.publishedAt,
        });
        if (!result.ok) {
          await settle({ kind: "failed", error: result.error });
        } else if (result.reading.status === "unavailable") {
          await settle({ kind: "post_unknown", reason: result.reading.reason });
        } else if (result.reading.status === "no_data") {
          await settle({ kind: "no_data" });
        } else {
          const metrics = pickMetrics(item.kind, result.reading.metrics);
          await settle(Object.keys(metrics).length > 0 ? { kind: "taken", metrics } : { kind: "no_data" });
        }
      } catch (error) {
        await settle({ kind: "failed", error: messageOf(error) });
      }
    }
    if (outcomes.length > 0) await ctx.runMutation(internal.analytics.recordMany, { outcomes });
  },
});
