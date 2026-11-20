import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server.js";
import { getTemplateRegistry } from "./template_registry.js";
import { assertMissionCreatable } from "./mission_validation.js";
import { messageOf } from "./error_message.js";
import { planItemV, type PlanItem } from "./plan_schema.js";
import { createMissionLikeManual, markMissionDone } from "./missions.js";

/** The Template that executes each Mission type of the Project: the first active agent that declares it. */
async function templateOfMissionTypes(ctx: QueryCtx, instanceId: string): Promise<Map<string, string>> {
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
  return templateOfType;
}

type CheckedItem = { position: number; item: PlanItem; templateId: string };

/**
 * Each item with the Template that would execute it, and the refusals of the ones that cannot be created,
 * by the rules of a manual Mission creation. `positions` are the 0-based places of the items in the Plan,
 * so a refusal names the item the user sees. Read-only.
 */
async function checkPlanItems(
  ctx: QueryCtx,
  instanceId: string,
  items: ReadonlyArray<{ position: number; item: PlanItem }>,
): Promise<{ checked: CheckedItem[]; errors: string[] }> {
  const templateOfType = await templateOfMissionTypes(ctx, instanceId);
  const checked: CheckedItem[] = [];
  const errors: string[] = [];
  for (const { position, item } of items) {
    const at = `plan item ${position + 1} (${item.type})`;
    const templateId = templateOfType.get(item.type);
    if (!templateId) {
      errors.push(`${at}: Mission type "${item.type}" is not active in this Project`);
      continue;
    }
    try {
      await assertMissionCreatable(ctx, { instanceId, templateId, type: item.type, payload: item.payload });
      checked.push({ position, item, templateId });
    } catch (error) {
      errors.push(`${at}: ${messageOf(error)}`);
    }
  }
  return { checked, errors };
}

/**
 * The refusals of each Plan item, with its position (1-based), by the rules of a manual Mission creation.
 * An item's Mission type is executed by the Project's active agent that declares it: none means the type
 * is not active in this Project. Read-only.
 */
export async function planItemErrors(ctx: QueryCtx, instanceId: string, items: readonly PlanItem[]): Promise<string[]> {
  const { errors } = await checkPlanItems(ctx, instanceId, items.map((item, position) => ({ position, item })));
  return errors;
}

/** What the reconciliation asks before it accepts a Plan: the refusals, empty when every item could be created. */
export const checkItems = internalQuery({
  args: { instanceId: v.string(), items: v.array(planItemV) },
  handler: (ctx, args) => planItemErrors(ctx, args.instanceId, args.items),
});

/**
 * The effect of approving a Plan (ADR-080, ADR-081). The selected items become Missions created and launched
 * as a manual creation would, the others are recorded as declined on the Plan Mission, which is done.
 * Each selected item is checked again, because the Project may have changed since the Plan was written: if any
 * is refused, nothing is created and the Plan stays to review, the reasons name each item.
 * `selection` is the 0-based positions of the selected items; absent means every item.
 */
export const approve = internalMutation({
  args: { missionId: v.id("missions"), selection: v.optional(v.array(v.number())) },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    if (mission.status !== "to_validate") {
      throw new Error(`A Plan can only be approved while it is to validate, got: "${mission.status}"`);
    }
    const plan = (mission.lastResult as { plan?: PlanItem[] } | undefined)?.plan;
    if (!plan) throw new Error("This Mission has no Plan to approve");

    const positions = args.selection ?? plan.map((_, position) => position);
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0 || position >= plan.length) {
        throw new Error(`The Plan has no item ${position + 1}`);
      }
    }
    const selected = [...new Set(positions)].sort((a, b) => a - b);
    if (selected.length === 0) {
      throw new Error("Select at least one item to approve, or reject the Plan");
    }

    const { checked, errors } = await checkPlanItems(
      ctx,
      mission.instanceId,
      selected.map((position) => ({ position, item: plan[position]! })),
    );
    if (errors.length > 0) {
      throw new Error(`The Plan is not approved, nothing was created. ${errors.join("; ")}`);
    }

    for (const { item, templateId } of checked) {
      await createMissionLikeManual(ctx, {
        ownerId: mission.ownerId,
        instanceId: mission.instanceId,
        templateId,
        type: item.type,
        payload: item.payload,
        fromPlan: { missionId: mission._id, reason: item.reason, figures: item.figures },
      });
    }

    const declined = plan.filter((_, position) => !selected.includes(position));
    await ctx.db.patch(mission._id, { declinedPlanItems: declined });
    await markMissionDone(ctx, mission._id);
  },
});
