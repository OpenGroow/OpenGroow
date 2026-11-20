import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server.js";
import { getTemplateRegistry } from "./template_registry.js";
import { assertMissionCreatable } from "./mission_validation.js";
import { messageOf } from "./error_message.js";
import { planItemV, type PlanItem } from "./plan_schema.js";

/**
 * The refusals of each Plan item, with its position (1-based), by the rules of a manual Mission creation.
 * An item's Mission type is executed by the Project's active agent that declares it: none means the type
 * is not active in this Project. Read-only.
 */
export async function planItemErrors(ctx: QueryCtx, instanceId: string, items: readonly PlanItem[]): Promise<string[]> {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "active"))
    .take(100);
  const registry = getTemplateRegistry(ctx);
  const templateOfType = new Map<string, string>();
  for (const agent of agents) {
    const template = await registry.resolve(instanceId, agent.templateId);
    for (const missionType of template?.manifest.missionTypes ?? []) {
      if (!templateOfType.has(missionType.type)) templateOfType.set(missionType.type, agent.templateId);
    }
  }

  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    const at = `plan item ${index + 1} (${item.type})`;
    const templateId = templateOfType.get(item.type);
    if (!templateId) {
      errors.push(`${at}: Mission type "${item.type}" is not active in this Project`);
      continue;
    }
    try {
      await assertMissionCreatable(ctx, { instanceId, templateId, type: item.type, payload: item.payload });
    } catch (error) {
      errors.push(`${at}: ${messageOf(error)}`);
    }
  }
  return errors;
}

/** What the reconciliation asks before it accepts a Plan: the refusals, empty when every item could be created. */
export const checkItems = internalQuery({
  args: { instanceId: v.string(), items: v.array(planItemV) },
  handler: (ctx, args) => planItemErrors(ctx, args.instanceId, args.items),
});
