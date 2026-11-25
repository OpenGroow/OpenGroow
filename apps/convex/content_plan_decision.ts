import { v } from "convex/values";
import { remainingOf, utcDateOf } from "@opengroow/protocol/content-planning-pins";
import type { Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx } from "./_generated/server.js";
import { resolveItem } from "./content_plans.js";
import { ownerIdFor } from "./instance_ownership.js";
import { projectPublishers } from "./project_publishers.js";

// Decision on a whole Content Plan (ADR-086, issue #181). Each decision is one atomic mutation: the plan is read
// as `draft` and written in the same transaction, so two concurrent decisions cannot both succeed. Approval creates
// no Mission, production or Publication; it only marks the plan and its retained contents `approved`.

const MAX_EXISTING_READ = 1_000;

export type DecisionResult =
  | { ok: true }
  | { ok: false; reason: "not_draft" | "no_content" | "past_date" | "invalid" | "over_quota"; message: string };

const refuse = (reason: Extract<DecisionResult, { ok: false }>["reason"], message: string): DecisionResult => ({ ok: false, reason, message });

/** The draft plan and its contents, after the owner check; refuses a plan that was already decided. */
async function loadDraft(ctx: MutationCtx, planId: Id<"contentPlans">) {
  const plan = await ctx.db.get(planId);
  if (!plan) throw new Error("Content Plan not found");
  await ownerIdFor(ctx, plan.instanceId);
  const contents = await ctx.db.query("plannedContents").withIndex("by_plan", (q) => q.eq("planId", planId)).collect();
  return { plan, contents };
}

const notDraft = (status: string) => refuse("not_draft", `This Content Plan is already ${status}; only a draft can be decided.`);

/**
 * Approves the plan: revalidates every retained (`proposed`) content against the Project as it is now, using the
 * targets pinned on the Run and the existing quantity recomputed now. Approving below the targets is allowed.
 */
export const approve = mutation({
  args: { planId: v.id("contentPlans") },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const { plan, contents } = await loadDraft(ctx, args.planId);
    if (plan.status !== "draft") return notDraft(plan.status);
    const retained = contents.filter((content) => content.status === "proposed");
    if (retained.length === 0) return refuse("no_content", "No content is retained: keep at least one content or reject the plan.");
    const today = utcDateOf(Date.now());
    const past = retained.filter((content) => content.plannedAt < today);
    if (past.length > 0) {
      return refuse("past_date", `${past.length} retained ${past.length === 1 ? "content is" : "contents are"} dated in the past (${[...new Set(past.map((c) => c.plannedAt))].sort().join(", ")}): change the date or remove it.`);
    }

    const run = await ctx.db.get(plan.runId);
    const pins = run?.contentPlanning;
    if (!run || !pins) return refuse("invalid", "The Run that produced this plan no longer carries its targets: reject the plan and plan again.");

    const publishers = await projectPublishers(ctx, plan.instanceId);
    const errors: string[] = [];
    for (const [index, content] of retained.entries()) {
      const outcome = await resolveItem(ctx, run, pins, { missionType: content.missionType, recipeId: content.recipeId, ...(content.sourceId ? { sourceId: content.sourceId } : {}) }, `"${content.title}" (#${index + 1})`, publishers);
      if (!outcome.ok) errors.push(...outcome.errors);
    }
    if (errors.length > 0) return refuse("invalid", errors.join(" "));

    // Existing quantity now: approved contents of the period, from any plan (this one is still a draft).
    const approved = await ctx.db
      .query("plannedContents")
      .withIndex("by_instance_status_plannedAt", (q) => q.eq("instanceId", plan.instanceId).eq("status", "approved").gte("plannedAt", plan.periodStart).lte("plannedAt", plan.periodEnd))
      .take(MAX_EXISTING_READ);
    const overs: string[] = [];
    for (const target of pins.targets) {
      const count = retained.filter((content) => content.kind === target.kind).length;
      const remaining = remainingOf(target.target, approved.filter((content) => content.kind === target.kind).length);
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
    const { plan, contents } = await loadDraft(ctx, args.planId);
    if (plan.status !== "draft") return notDraft(plan.status);
    for (const content of contents) if (content.status === "proposed") await ctx.db.patch(content._id, { status: "rejected" });
    await ctx.db.patch(plan._id, { status: "rejected", rejectedAt: Date.now() });
    return { ok: true };
  },
});
