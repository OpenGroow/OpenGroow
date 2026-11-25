import { v } from "convex/values";
import { capabilityFor } from "@opengroow/publisher-sdk";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import type { Doc, Id } from "./_generated/dataModel.js";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";
import { channelOf, projectPublishers } from "./project_publishers.js";
import { publisherMetaOf } from "./publisher_packages.js";
import { getTemplateRegistry } from "./template_registry.js";

// Dashboard reads of Content Plans (ADR-086, issue #179): the current draft with its Planned Contents, then the
// history. Owner-scoped and read-only; the mutations of review (edit, approve, reject) are added next to these.
// Nothing derived is stored: Publisher compatibility, Creative Family and the intent distribution are computed here.

const HISTORY_LIMIT = 50;

const planView = (plan: Doc<"contentPlans">) => {
  const { _id, periodStart, periodEnd, rationale, status, createdAt, approvedAt, rejectedAt } = plan;
  return { _id, periodStart, periodEnd, rationale, status, createdAt, approvedAt, rejectedAt };
};

/** Every Planned Content of a plan, whatever its status. */
export const contentsOf = (ctx: QueryCtx | MutationCtx, planId: Id<"contentPlans">) => ctx.db.query("plannedContents").withIndex("by_plan", (q) => q.eq("planId", planId)).collect();

/** What a Planned Content shows: its references resolved by name, and its destinations re-checked against the Publishers. */
async function contentView(ctx: QueryCtx, content: Doc<"plannedContents">, publishers: Awaited<ReturnType<typeof projectPublishers>>) {
  const own = <T extends { instanceId: string }>(doc: T | null) => (doc && doc.instanceId === content.instanceId ? doc : null);
  const recipe = own(await ctx.db.get(content.recipeId));
  const family = recipe ? own(await ctx.db.get(recipe.creativeFamilyId)) : null;
  const source = content.sourceId ? own(await ctx.db.get(content.sourceId)) : null;
  const template = recipe ? await getTemplateRegistry(ctx).resolve(content.instanceId, recipe.templateId) : null;
  const declaration = publishDeclarationFor(template?.manifest, content.missionType);

  const publishTargets = [];
  for (const target of content.publishTargets) {
    const found = channelOf(publishers, target);
    if (!found) {
      publishTargets.push({ target, uncertain: false, unavailable: true });
      continue;
    }
    const capabilities = (await publisherMetaOf(ctx, found.publisher.adapter))?.capabilities;
    const capability = capabilityFor(capabilities, found.channel.channelService, content.kind, declaration?.platforms);
    publishTargets.push(
      capability.level === "uncertain" ? { target, uncertain: true, reason: capability.reason ?? "" }
      : capability.level === "unsupported" ? { target, uncertain: false, unsupported: true, reason: capability.reason ?? "" }
      : { target, uncertain: false },
    );
  }
  const { _id, kind, missionType, title, brief, plannedAt, intent, rationale, status } = content;
  return {
    _id, kind, missionType, title, brief, plannedAt, intent, rationale, status, publishTargets,
    recipe: recipe ? { id: recipe._id, name: recipe.name } : null,
    creativeFamily: family ? { id: family._id, name: family.name } : null,
    source: source ? { id: source._id, label: source.label } : null,
  };
}

/** The Project's draft Content Plan with its contents (by date), quantities by format and intent distribution, or null. */
export const current = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return null;
    const draft = await ctx.db.query("contentPlans").withIndex("by_instance_status", (q) => q.eq("instanceId", args.instanceId).eq("status", "draft")).first();
    if (!draft) return null;
    const publishers = await projectPublishers(ctx, args.instanceId);
    const rows = (await contentsOf(ctx, draft._id)).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || a.createdAt - b.createdAt);
    const contents = await Promise.all(rows.map((row) => contentView(ctx, row, publishers)));
    const byKind = new Map<string, number>();
    // A removed proposal is kept (shown struck) but counts toward nothing.
    const live = rows.filter((row) => row.status !== "rejected");
    for (const { kind } of live) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    return {
      ...planView(draft),
      contents,
      quantities: [...byKind].map(([kind, count]) => ({ kind, count })),
      distribution: { explore: live.filter((row) => row.intent === "explore").length, exploit: live.filter((row) => row.intent === "exploit").length },
    };
  },
});

/** The Project's approved and rejected plans, newest first (the draft is shown by `current`). */
export const history = query({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    if ((await readOwnerId(ctx, args.instanceId)) === null) return [];
    const plans: Doc<"contentPlans">[] = [];
    for (const status of ["approved", "rejected"] as const) {
      plans.push(...(await ctx.db.query("contentPlans").withIndex("by_instance_status", (q) => q.eq("instanceId", args.instanceId).eq("status", status)).order("desc").take(HISTORY_LIMIT)));
    }
    plans.sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(
      plans.slice(0, HISTORY_LIMIT).map(async (plan) => {
        const contents = await contentsOf(ctx, plan._id);
        const count = (status: string) => contents.filter((content) => content.status === status).length;
        return { ...planView(plan), counts: { total: contents.length, approved: count("approved"), rejected: count("rejected") } };
      }),
    );
  },
});
