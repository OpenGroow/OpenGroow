import type { QueryCtx } from "../_generated/server.js";

/**
 * Whether the Agent has a Run in progress (ADR-080): the only time its token
 * works. Checked on every call, never cached, because the token is long-lived.
 */
export async function hasRunInProgress(ctx: Pick<QueryCtx, "db">, instanceId: string, templateId: string): Promise<boolean> {
  const run = await ctx.db
    .query("runs")
    .withIndex("by_instance_template_status", (q) => q.eq("instanceId", instanceId).eq("templateId", templateId).eq("status", "running"))
    .first();
  return run !== null;
}
