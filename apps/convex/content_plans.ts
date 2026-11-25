import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { publishDeclarationFor } from "@opengroow/agent-templates";
import { capabilityFor } from "@opengroow/publisher-sdk";
import { parseContentPlanEnvelope, type PlannedItem } from "./content_plan_rules.js";
import { channelOf, projectPublishers, type ProjectPublisher } from "./project_publishers.js";
import { publisherMetaOf } from "./publisher_packages.js";
import { getTemplateRegistry } from "./template_registry.js";

// Persistence of Content Plans (ADR-086, issue #176). One atomic mutation context: the result of a Content Planning
// Run is validated as a whole against the Project and the pins taken at dispatch, then written as one `draft` plan
// with its `proposed` Planned Contents, or not at all. Nothing else is written (no Mission, Publication, Recipe
// or Strategic Memory).

/** The provider that makes a Mission type need a Source. */
const SOURCE_PROVIDER = "observation-production-source";

export type PersistPlanResult =
  | { ok: true; planId: Id<"contentPlans"> | null; created: boolean; count: number; uncertain: Array<{ index: number; target: string; reason: string }> }
  | { ok: false; reason: "invalid_result" | "draft_exists"; message: string };

const invalid = (errors: string[]): PersistPlanResult => ({ ok: false, reason: "invalid_result", message: errors.join(" ") });

export type Resolved = { kind: string; publishTargets: string[] };

/** Checks one item against the Project; returns what the Core fills in, or the reasons it is refused. */
export async function resolveItem(
  ctx: MutationCtx,
  run: Doc<"runs">,
  pins: NonNullable<Doc<"runs">["contentPlanning"]>,
  item: Pick<PlannedItem, "missionType" | "recipeId" | "sourceId">,
  at: string,
  publishers: readonly ProjectPublisher[],
): Promise<{ ok: true; value: Resolved; uncertain: Array<{ target: string; reason: string }> } | { ok: false; errors: string[] }> {
  const recipeId = ctx.db.normalizeId("productionRecipes", item.recipeId);
  const recipe = recipeId ? await ctx.db.get(recipeId) : null;
  if (!recipe || recipe.instanceId !== run.instanceId) return { ok: false, errors: [`${at}: recipeId does not name a Recipe of this Project.`] };
  if (recipe.status !== "active") return { ok: false, errors: [`${at}: the Recipe is archived.`] };
  if (recipe.missionType !== item.missionType) {
    return { ok: false, errors: [`${at}: the Recipe is written for Mission type "${recipe.missionType}", not "${item.missionType}".`] };
  }
  const agent = await ctx.db
    .query("projectAgents")
    .withIndex("by_instance_template", (q) => q.eq("instanceId", run.instanceId).eq("templateId", recipe.templateId))
    .unique();
  if (!agent || agent.status !== "active" || (agent.hiddenMissionTypes ?? []).includes(item.missionType)) {
    return { ok: false, errors: [`${at}: no active Agent offers Mission type "${item.missionType}".`] };
  }
  const template = await getTemplateRegistry(ctx).resolve(run.instanceId, recipe.templateId);
  const manifestType = template?.manifest.missionTypes?.find((entry) => entry.type === item.missionType);
  const declaration = publishDeclarationFor(template?.manifest, item.missionType);
  if (!manifestType || !declaration) return { ok: false, errors: [`${at}: Mission type "${item.missionType}" does not publish a format.`] };
  const pinned = pins.targets.find((entry) => entry.kind === declaration.kind);
  if (!pinned) return { ok: false, errors: [`${at}: format "${declaration.kind}" has no production target.`] };

  const errors: string[] = [];
  const needsSource = (manifestType.contextProviders ?? template?.manifest.contextProviders ?? []).includes(SOURCE_PROVIDER);
  if (needsSource && item.sourceId === undefined) errors.push(`${at}: Mission type "${item.missionType}" needs a Source (sourceId).`);
  if (item.sourceId !== undefined) {
    const sourceId = ctx.db.normalizeId("sources", item.sourceId);
    const source = sourceId ? await ctx.db.get(sourceId) : null;
    if (!source || source.instanceId !== run.instanceId) errors.push(`${at}: sourceId does not name a Source of this Project.`);
  }

  // The destinations are the user's pinned ones for this format; a channel removed since is left out.
  const publishTargets: string[] = [];
  const uncertain: Array<{ target: string; reason: string }> = [];
  for (const target of pinned.publishTargets) {
    const found = channelOf(publishers, target);
    if (!found) continue;
    publishTargets.push(target);
    const capabilities = (await publisherMetaOf(ctx, found.publisher.adapter))?.capabilities;
    const capability = capabilityFor(capabilities, found.channel.channelService, declaration.kind, declaration.platforms);
    if (capability.level === "unsupported") errors.push(`${at}: ${capability.reason} (channel "${target}").`);
    else if (capability.level === "uncertain") uncertain.push({ target, reason: capability.reason ?? "" });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { kind: declaration.kind, publishTargets }, uncertain };
}

/**
 * Validates and persists the result of a Content Planning Run. Idempotent: the plan already persisted for the Run is
 * returned, and a Run already completed (an empty result creates no plan) changes nothing. The same mutation
 * checks for a draft and inserts, so two concurrent completions cannot produce two drafts.
 */
export async function persistContentPlan(ctx: MutationCtx, run: Doc<"runs">, envelope: unknown): Promise<PersistPlanResult> {
  const pins = run.contentPlanning;
  if (!pins) return invalid(["The Run carries no Planning period."]);
  const existing = await ctx.db.query("contentPlans").withIndex("by_instance_run", (q) => q.eq("instanceId", run.instanceId).eq("runId", run._id)).first();
  if (existing) return { ok: true, planId: existing._id, created: false, count: 0, uncertain: [] };
  if (run.status === "completed") return { ok: true, planId: null, created: false, count: 0, uncertain: [] };

  const parsed = parseContentPlanEnvelope(envelope, pins);
  if (!parsed.ok) return invalid(parsed.errors);
  const { rationale, items } = parsed.value;
  if (items.length === 0) return { ok: true, planId: null, created: false, count: 0, uncertain: [] };

  const draft = await ctx.db.query("contentPlans").withIndex("by_instance_status", (q) => q.eq("instanceId", run.instanceId).eq("status", "draft")).first();
  if (draft) return { ok: false, reason: "draft_exists", message: "A draft Content Plan is waiting for review: approve or reject it before a new one is planned." };

  const publishers = await projectPublishers(ctx, run.instanceId);
  const errors: string[] = [];
  const resolved: Resolved[] = [];
  const uncertain: Array<{ index: number; target: string; reason: string }> = [];
  for (const [index, item] of items.entries()) {
    const outcome = await resolveItem(ctx, run, pins, item, `items[${index}]`, publishers);
    if (outcome.ok) {
      resolved.push(outcome.value);
      uncertain.push(...outcome.uncertain.map((entry) => ({ index, ...entry })));
    } else errors.push(...outcome.errors);
  }
  if (errors.length === 0) {
    const counts = new Map<string, number>();
    for (const { kind } of resolved) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    for (const [kind, count] of counts) {
      const remaining = pins.targets.find((entry) => entry.kind === kind)?.remaining ?? 0;
      if (count > remaining) errors.push(`Format "${kind}": ${count} contents proposed but only ${remaining} remain to plan.`);
    }
  }
  if (errors.length > 0) return invalid(errors);

  const now = Date.now();
  const planId = await ctx.db.insert("contentPlans", {
    ownerId: run.ownerId, instanceId: run.instanceId, runId: run._id, periodStart: pins.periodStart, periodEnd: pins.periodEnd,
    rationale, status: "draft", createdAt: now,
  });
  for (const [index, item] of items.entries()) {
    await ctx.db.insert("plannedContents", {
      ownerId: run.ownerId, instanceId: run.instanceId, planId, kind: resolved[index]!.kind, missionType: item.missionType,
      recipeId: ctx.db.normalizeId("productionRecipes", item.recipeId)!,
      ...(item.sourceId !== undefined ? { sourceId: ctx.db.normalizeId("sources", item.sourceId)! } : {}),
      publishTargets: resolved[index]!.publishTargets, title: item.title, brief: item.brief, plannedAt: item.plannedAt,
      intent: item.intent, rationale: item.rationale, status: "proposed", createdAt: now,
    });
  }
  return { ok: true, planId, created: true, count: items.length, uncertain };
}
