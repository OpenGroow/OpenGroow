import { v } from "convex/values";
import { remainingOf, utcDateOf } from "@opengroow/protocol/content-planning-pins";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { approvedCountsByKind, countByKind } from "./content_plan_counts.js";
import { contentsOf } from "./content_plan_review.js";
import { NO_PINS_MESSAGE, pinsOf, resolveItem } from "./content_plans.js";
import { ownerIdFor } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";

// Decision on a whole Content Plan (ADR-086, issue #181). Each decision is one atomic mutation: the plan is read
// as `draft` and written in the same transaction, so two concurrent decisions cannot both succeed. Approval creates
// no Mission, production or Publication; it only marks the plan and its retained contents `approved`.

export type DecisionResult =
  | { ok: true }
  | { ok: false; reason: "not_draft" | "no_content" | "past_date" | "invalid" | "over_quota"; message: string };

const refuse = (reason: Extract<DecisionResult, { ok: false }>["reason"], message: string): DecisionResult => ({ ok: false, reason, message });

const notDraft = (status: string) => refuse("not_draft", `This Content Plan is already ${status}; only a draft can be decided.`);

/** The plan and its `proposed` contents, after the owner check; a plan that was already decided is refused before any content is read. */
async function loadDraft(ctx: MutationCtx, planId: Id<"contentPlans">): Promise<{ plan: Doc<"contentPlans">; retained: Doc<"plannedContents">[] } | DecisionResult> {
  const plan = await ctx.db.get(planId);
  if (!plan) throw new Error("Content Plan not found");
  await ownerIdFor(ctx, plan.instanceId);
  if (plan.status !== "draft") return notDraft(plan.status);
  return { plan, retained: (await contentsOf(ctx, planId)).filter((content) => content.status === "proposed") };
}

/**
 * Approves the plan: revalidates every retained (`proposed`) content against the Project as it is now, using the
 * targets pinned on the Run and the existing quantity recomputed now. Approving below the targets is allowed.
 */
export const approve = mutation({
  args: { planId: v.id("contentPlans") },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const loaded = await loadDraft(ctx, args.planId);
    if ("ok" in loaded) return loaded;
    const { plan, retained } = loaded;
    if (retained.length === 0) return refuse("no_content", "No content is retained: keep at least one content or reject the plan.");
    const today = utcDateOf(Date.now());
    const past = retained.filter((content) => content.plannedAt < today);
    if (past.length > 0) {
      return refuse("past_date", `${past.length} retained ${past.length === 1 ? "content is" : "contents are"} dated in the past (${[...new Set(past.map((c) => c.plannedAt))].sort().join(", ")}): change the date or remove it.`);
    }

    const carried = await pinsOf(ctx, plan);
    if (!carried) return refuse("invalid", NO_PINS_MESSAGE);
    const { run, pins } = carried;

    const publishers = await projectPublishers(ctx, plan.instanceId);
    const errors: string[] = [];
    for (const [index, content] of retained.entries()) {
      const outcome = await resolveItem(ctx, run, pins, { missionType: content.missionType, recipeId: content.recipeId, ...(content.sourceId ? { sourceId: content.sourceId } : {}) }, `"${content.title}" (#${index + 1})`, publishers);
      if (!outcome.ok) errors.push(...outcome.errors);
      // The destinations of the content itself (possibly narrowed by an edit): none may be left without an available channel.
      if (!content.publishTargets.some((target) => channelOf(publishers, target))) {
        errors.push(`"${content.title}" (#${index + 1}): none of its Publish targets is available any more.`);
      }
    }
    if (errors.length > 0) return refuse("invalid", errors.join(" "));

    // Existing quantity now: approved contents of the period, from any plan (this one is still a draft).
    const approved = await approvedCountsByKind(ctx, plan.instanceId, plan.periodStart, plan.periodEnd);
    const overs: string[] = [];
    const retainedByKind = countByKind(retained);
    for (const target of pins.targets) {
      const count = retainedByKind.get(target.kind) ?? 0;
      const remaining = remainingOf(target.target, approved.get(target.kind) ?? 0);
      if (count > remaining) overs.push(`Format "${target.kind}": ${count} contents retained but only ${remaining} remain to plan.`);
    }
    if (overs.length > 0) return refuse("over_quota", overs.join(" "));

    const now = Date.now();
    for (const content of retained) await ctx.db.patch(content._id, { status: "approved" });
    await ctx.db.patch(plan._id, { status: "approved", approvedAt: now });
    return { ok: true };
  },
});

/** Rejects the plan and its `proposed` contents. A new Content Planning Run may then plan again. */
export const reject = mutation({
  args: { planId: v.id("contentPlans") },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const loaded = await loadDraft(ctx, args.planId);
    if ("ok" in loaded) return loaded;
    const { plan, retained } = loaded;
    for (const content of retained) await ctx.db.patch(content._id, { status: "rejected" });
    await ctx.db.patch(plan._id, { status: "rejected", rejectedAt: Date.now() });
    return { ok: true };
  },
});
