import { v } from "convex/values";
import type { capabilityFor } from "@opengroow/publisher-sdk";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import type { Doc, Id } from "./_generated/dataModel.js";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import { readOwnerId } from "./instance_ownership.js";
import { countByKind } from "./content_plan_counts.js";
import { capabilityOfTarget, channelOf, projectPublishers, type ProjectPublisher, type PublisherChannelEntry } from "./project_publishers.js";
import { getTemplateRegistry } from "./template_registry.js";

// Dashboard reads of Content Plans (ADR-086, issue #179): the current draft with its Planned Contents, then the
// history. Owner-scoped and read-only; the mutations of review (edit, approve, reject) are added next to these.
// Nothing derived is stored: Publisher compatibility and the intent distribution are computed here.

const HISTORY_LIMIT = 50;

const planView = (plan: Doc<"contentPlans">) => {
  const { _id, periodStart, periodEnd, rationale, status, createdAt, approvedAt, rejectedAt } = plan;
  return { _id, periodStart, periodEnd, rationale, status, createdAt, approvedAt, rejectedAt };
};

/** Every Planned Content of a plan, whatever its status. */
export const contentsOf = (ctx: QueryCtx | MutationCtx, planId: Id<"contentPlans">) => ctx.db.query("plannedContents").withIndex("by_plan", (q) => q.eq("planId", planId)).collect();

/** A channel's display label: `@handle` (stored profile, else the key's part after the service), the bare name when it is not a handle (e.g. a repository). */
export function channelLabel(channel: PublisherChannelEntry): string {
  const colon = channel.target.indexOf(":");
  const handle = channel.channelProfile ?? (colon >= 0 ? channel.target.slice(colon + 1) : undefined);
  if (!handle) return channel.channelName ?? channel.target;
  return handle.includes("/") ? handle : `@${handle}`;
}

/** Memoizes an async lookup by key for the lifetime of one read, so a plan of many items reads each document once. */
function memoized<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    let found = cache.get(key);
    if (!found) {
      found = load(key);
      cache.set(key, found);
    }
    return found;
  };
}

const byPlannedDate = (a: Doc<"plannedContents">, b: Doc<"plannedContents">) => a.plannedAt.localeCompare(b.plannedAt) || a.createdAt - b.createdAt;

/** The Planned Contents of a plan as the dashboard shows them (by date): what they reference is read once per distinct document. */
async function contentViews(ctx: QueryCtx, rows: readonly Doc<"plannedContents">[], publishers: readonly ProjectPublisher[]) {
  const instanceOf = <T extends { instanceId: string }>(instanceId: string, doc: T | null) => (doc && doc.instanceId === instanceId ? doc : null);
  const recipeOf = memoized((recipeId: Id<"productionRecipes">) => ctx.db.get(recipeId));
  const sourceOf = memoized((sourceId: Id<"sources">) => ctx.db.get(sourceId));
  const registry = getTemplateRegistry(ctx);
  const templateOf = memoized((key: string) => {
    const [instanceId, templateId] = JSON.parse(key) as [string, string];
    return registry.resolve(instanceId, templateId);
  });
  const capabilityOf = memoized((key: string) => {
    const [target, kind, platforms] = JSON.parse(key) as [string, string, string[] | null];
    const found = channelOf(publishers, target)!;
    return capabilityOfTarget(ctx, found, kind, platforms ?? undefined);
  });
  return await Promise.all(rows.map((content) => contentView(content, publishers, { instanceOf, recipeOf, sourceOf, templateOf, capabilityOf })));
}

type ViewLookups = {
  instanceOf: <T extends { instanceId: string }>(instanceId: string, doc: T | null) => T | null;
  recipeOf: (id: Id<"productionRecipes">) => Promise<Doc<"productionRecipes"> | null>;
  sourceOf: (id: Id<"sources">) => Promise<Doc<"sources"> | null>;
  templateOf: (key: string) => Promise<Awaited<ReturnType<ReturnType<typeof getTemplateRegistry>["resolve"]>>>;
  capabilityOf: (key: string) => Promise<ReturnType<typeof capabilityFor>>;
};

/** What a Planned Content shows: its references resolved by name, and its destinations re-checked against the Publishers. */
async function contentView(content: Doc<"plannedContents">, publishers: readonly ProjectPublisher[], lookups: ViewLookups) {
  const { instanceOf, recipeOf, sourceOf, templateOf, capabilityOf } = lookups;
  const recipe = instanceOf(content.instanceId, await recipeOf(content.recipeId));
  const [source, template] = await Promise.all([
    content.sourceId ? sourceOf(content.sourceId).then((doc) => instanceOf(content.instanceId, doc)) : null,
    recipe ? templateOf(JSON.stringify([content.instanceId, recipe.templateId])) : null,
  ]);
  const declaration = publishDeclarationFor(template?.manifest, content.missionType);

  const publishTargets = [];
  for (const target of content.publishTargets) {
    const found = channelOf(publishers, target);
    if (!found) {
      publishTargets.push({ target, uncertain: false, unavailable: true });
      continue;
    }
    const { channel, publisher } = found;
    const identity = { service: channel.channelService, adapter: publisher.adapter, label: channelLabel(channel) };
    const capability = await capabilityOf(JSON.stringify([target, content.kind, declaration?.platforms ?? null]));
    publishTargets.push(
      capability.level === "uncertain" ? { target, uncertain: true, reason: capability.reason ?? "", ...identity }
      : capability.level === "unsupported" ? { target, uncertain: false, unsupported: true, reason: capability.reason ?? "", ...identity }
      : { target, uncertain: false, ...identity },
    );
  }
  const { _id, kind, missionType, title, brief, plannedAt, intent, rationale, status } = content;
  return {
    _id, kind, missionType, title, brief, plannedAt, intent, rationale, status, publishTargets,
    recipe: recipe ? { id: recipe._id, name: recipe.name } : null,
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
    const rows = (await contentsOf(ctx, draft._id)).sort(byPlannedDate);
    const contents = await contentViews(ctx, rows, publishers);
    // A removed proposal is kept (shown struck) but counts toward nothing.
    const live = rows.filter((row) => row.status !== "rejected");
    const byKind = countByKind(live);
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

/** The Planned Contents of one plan (by date, removed and rejected ones included) for the read-only history view, or null. */
export const planDetail = query({
  args: { planId: v.id("contentPlans") },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan || (await readOwnerId(ctx, plan.instanceId)) === null) return null;
    const publishers = await projectPublishers(ctx, plan.instanceId);
    const rows = (await contentsOf(ctx, plan._id)).sort(byPlannedDate);
    return await contentViews(ctx, rows, publishers);
  },
});
