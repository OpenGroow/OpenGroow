import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server.js";
import { getTemplateRegistry } from "./template_registry.js";
import { assertMissionCreatable } from "./mission_validation.js";
import { messageOf } from "./error_message.js";
import { planItemV, type PlanItem } from "./plan_schema.js";
import { listPublicationReadings } from "./analytics_summary.js";
import { createMissionLikeManual, markMissionDone } from "./missions.js";

type MissionTypeExecutor = { templateId: string; isPlan: boolean };

/** The Template that executes each Mission type of the Project (the first active agent that declares it),
 * and whether the type is reviewed as a Plan. */
async function executorOfMissionTypes(ctx: QueryCtx, instanceId: string): Promise<Map<string, MissionTypeExecutor>> {
  const agents = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "active"))
    .take(100);
  const registry = getTemplateRegistry(ctx);
  const executorOfType = new Map<string, MissionTypeExecutor>();
  for (const agent of agents) {
    const template = await registry.resolve(instanceId, agent.templateId);
    for (const missionType of template?.manifest.missionTypes ?? []) {
      if (!executorOfType.has(missionType.type)) {
        executorOfType.set(missionType.type, { templateId: agent.templateId, isPlan: missionType.review?.kind === "plan" });
      }
    }
  }
  return executorOfType;
}

/**
 * Why a Mission cannot be what a Plan item is based on, or undefined when it can: it belongs to the Project,
 * is done and has a Publication with a measurement (analytics status "data"). A Mission of another Project
 * is refused like an unknown id, so nothing about it leaks.
 */
async function basedOnError(ctx: QueryCtx, instanceId: string, basedOn: string, measuredMissionIds: () => Promise<Set<string>>): Promise<string | undefined> {
  const missionId = ctx.db.normalizeId("missions", basedOn);
  const mission = missionId ? await ctx.db.get(missionId) : null;
  if (!mission || mission.instanceId !== instanceId) {
    return `basedOn "${basedOn}" is not a Mission of this Project: use the missionId that list_publications returns`;
  }
  const label = mission.number !== undefined ? `Mission #${mission.number}` : `Mission "${basedOn}"`;
  if (mission.status !== "done") return `basedOn ${label} is not done (${mission.status}): base the item on a done Mission`;
  if (!(await measuredMissionIds()).has(mission._id)) {
    return `basedOn ${label} has no measured Publication yet: base the item on a Mission whose Publication has analytics`;
  }
  return undefined;
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
  const executorOfType = await executorOfMissionTypes(ctx, instanceId);
  const checked: CheckedItem[] = [];
  const errors: string[] = [];
  let measured: Promise<Set<string>> | undefined;
  const measuredMissionIds = () =>
    (measured ??= listPublicationReadings(ctx, instanceId, { from: 0, to: Date.now() + 24 * 3_600_000 }, Infinity).then(
      (readings) => new Set(readings.filter((r) => r.status === "data").map((r) => r.missionId)),
    ));
  for (const { position, item } of items) {
    const at = `plan item ${position + 1} (${item.type})`;
    // A Plan stored before `basedOn` existed has none: it is refused like any item without a measured origin.
    const originError = item.basedOn
      ? await basedOnError(ctx, instanceId, item.basedOn, measuredMissionIds)
      : "basedOn is missing: start from a done Mission with measured analytics";
    if (originError) {
      errors.push(`${at}: ${originError}`);
      continue;
    }
    const executor = executorOfType.get(item.type);
    if (!executor) {
      errors.push(`${at}: Mission type "${item.type}" is not active in this Project`);
      continue;
    }
    // A Plan whose item is itself a Plan would plan again once approved, without end.
    if (executor.isPlan) {
      errors.push(`${at}: Mission type "${item.type}" is reviewed as a Plan, a Plan cannot contain a Plan`);
      continue;
    }
    const { templateId } = executor;
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

/** The numbers of the Project's Missions among `ids`, to name the Mission an item is based on. Others are left out. */
export async function basedOnNumbers(ctx: QueryCtx, instanceId: string, ids: readonly string[]): Promise<Record<string, number>> {
  const numbers: Record<string, number> = {};
  for (const id of new Set(ids)) {
    const missionId = ctx.db.normalizeId("missions", id);
    const mission = missionId ? await ctx.db.get(missionId) : null;
    if (mission && mission.instanceId === instanceId && mission.number !== undefined) numbers[id] = mission.number;
  }
  return numbers;
}

export const numbersOfMissions = internalQuery({
  args: { instanceId: v.string(), ids: v.array(v.string()) },
  handler: (ctx, args) => basedOnNumbers(ctx, args.instanceId, args.ids),
});

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
